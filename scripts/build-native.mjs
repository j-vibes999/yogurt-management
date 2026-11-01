import { createHash } from "node:crypto";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createBuildEnvironment, run, scanPayload } from "./build-desktop.mjs";

// The shipped Mac app is the Swift binary and its resources only: no Node runtime, Next/Prisma
// backend, supervisor helper or loopback listener. Node runs here only as the build tool
// (icon rendering). The archived Node package is build-native-legacy.mjs (parity oracle).
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/**
 * Keychain items remember the signature of the app that created them. An ad-hoc signature
 * changes with every build, so each update asks for Keychain access again; a certificate
 * identity stays the same. Prefer Developer ID, then Apple Development, else ad-hoc ("-").
 */
export function chooseSigningIdentity(listing, requested) {
  if (requested) return requested;
  const identities = [...listing.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(Developer ID Application|Apple Development): [^"]+"\s*$/gm)];
  const preferred = identities.find(match => match[2] === "Developer ID Application") ?? identities[0];
  return preferred ? preferred[1] : "-";
}

/** Paths that would mean a JavaScript runtime or legacy backend slipped into the package. */
export function legacyRuntimePath(relative) {
  return /(^|\/)(?:node|bootstrap\.cjs|yogurt-supervisor|NODE-LICENSE)$/.test(relative)
    || /(^|\/)(?:backend|runtime|Helpers|node_modules|\.next)(\/|$)/.test(relative);
}

async function captured(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", bytes => { output += bytes; });
    child.stderr.on("data", () => {});
    child.once("error", () => reject(new Error("Native build command could not start.")));
    child.once("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`Native build command failed (${code ?? "signal"}).`)));
  });
}
async function copyTree(source, destination) {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error("Native packaging refused a source symlink.");
  await cp(source, destination, { recursive: true, filter: async file => {
    if ((await lstat(file)).isSymbolicLink()) throw new Error("Native packaging refused a source symlink.");
    return true;
  } });
}
async function makeIcon(build, resources) {
  const { default: sharp } = await import("sharp");
  const iconset = path.join(build, "Yogurt.iconset");
  await rm(iconset, { recursive: true, force: true }); await mkdir(iconset);
  const icon = await readFile(path.join(repository, "desktop/icon.svg"));
  for (const size of [16, 32, 128, 256, 512]) {
    await sharp(icon).resize(size, size).png().toFile(path.join(iconset, `icon_${size}x${size}.png`));
    await sharp(icon).resize(size * 2, size * 2).png().toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  await run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "Yogurt.icns")]);
}
async function files(directory, base = directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(file, base)); else found.push(path.relative(base, file));
  }
  return found;
}

export async function buildNative({ dmg = false, signingIdentity } = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The native package targets Apple Silicon macOS.");
  const build = path.join(repository, "build/native");
  await mkdir(build, { recursive: true });
  const environment = createBuildEnvironment();
  const swift = ["build", "--package-path", path.join(repository, "native"), "--configuration", "release", "--arch", "arm64"];
  await run("/usr/bin/swift", swift, { cwd: repository, env: environment });
  const binaryDirectory = await captured("/usr/bin/swift", [...swift, "--show-bin-path"], { cwd: repository, env: environment });
  const output = path.join(repository, "dist-native");
  const application = path.join(output, "Yogurt Manager Native.app");
  await rm(application, { recursive: true, force: true });
  const contents = path.join(application, "Contents");
  const resources = path.join(contents, "Resources");
  const executables = path.join(contents, "MacOS");
  await Promise.all([mkdir(resources, { recursive: true }), mkdir(executables, { recursive: true })]);
  await copyFile(path.join(binaryDirectory, "YogurtNative"), path.join(executables, "YogurtNative"));
  // Every SwiftPM resource/privacy bundle, including transitive packages'. The generated Darwin
  // accessor checks Bundle.main.resourceURL; the MacOS copy serves executable-relative lookup.
  const bundles = (await readdir(binaryDirectory)).filter(name => name.endsWith(".bundle") || name.endsWith(".resources"));
  if (!bundles.includes("YogurtNative_YogurtNative.bundle")) throw new Error("The native Swift resource bundle is missing.");
  for (const name of bundles) {
    await copyTree(path.join(binaryDirectory, name), path.join(resources, name));
    await copyTree(path.join(binaryDirectory, name), path.join(executables, name));
  }
  const metadata = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  const plist = (await readFile(path.join(repository, "native/Info.plist"), "utf8")).replaceAll("__VERSION__", metadata.version);
  await writeFile(path.join(contents, "Info.plist"), plist);
  await makeIcon(build, resources);
  await chmod(path.join(executables, "YogurtNative"), 0o755);
  await run("/usr/bin/plutil", ["-lint", path.join(contents, "Info.plist")]);

  // Package policy: Swift binary and resources only, system-only linkage, no secrets.
  const packaged = await files(application);
  const legacy = packaged.filter(legacyRuntimePath);
  if (legacy.length) throw new Error(`Legacy JavaScript runtime file in the Swift package: ${legacy[0]}`);
  const libraries = (await captured("/usr/bin/otool", ["-L", path.join(executables, "YogurtNative")])).split("\n").slice(1).map(line => line.trim().split(" ")[0]).filter(Boolean);
  // Swift back-deployment shims resolve from /usr/lib/swift on current macOS (the first rpath);
  // a bundled copy at @loader_path covers older systems that lack them.
  const toolchain = (await captured("/usr/bin/otool", ["-l", path.join(executables, "YogurtNative")])).split("\n").map(line => /^\s*path (\S+) \(offset/.exec(line)?.[1]).find(entry => entry?.includes(".xctoolchain/"));
  for (const library of libraries.filter(name => /^@rpath\/libswiftCompatibility[A-Za-z]*\.dylib$/.test(name))) {
    if (!toolchain) throw new Error(`No toolchain copy for ${library}`);
    await copyFile(path.join(toolchain, path.basename(library)), path.join(executables, path.basename(library)));
  }
  const foreign = libraries.filter(library => !library.startsWith("/usr/lib/") && !library.startsWith("/System/Library/") && !/^@rpath\/libswiftCompatibility[A-Za-z]*\.dylib$/.test(library));
  if (foreign.length) throw new Error(`The Swift binary links a non-system library: ${foreign[0]}`);
  await scanPayload(application);
  const resource = path.join(resources, "YogurtNative_YogurtNative.bundle");
  const pinnedRoot = (await files(resource)).find(name => name.endsWith("supabase-root-2021.pem"));
  if (!pinnedRoot) throw new Error("The pinned Supabase root certificate is missing from the package.");

  const identity = chooseSigningIdentity(await captured("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]), signingIdentity);
  await run("/usr/bin/codesign", ["--force", "--deep", "--timestamp=none", "--sign", identity, application]);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", application]);
  const manifest = {
    version: 2, engine: "swift", signing: identity === "-" ? "ad-hoc" : "certificate",
    binarySHA256: sha256(await readFile(path.join(executables, "YogurtNative"))),
    supabaseRootSHA256: sha256(await readFile(path.join(resource, pinnedRoot))),
    bundles, files: packaged.length, linkedLibraries: libraries,
  };
  // Outside the signed bundle: writing new resources after signing invalidates it.
  await writeFile(path.join(output, "native-build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  let installer = null;
  if (dmg) {
    const staging = await mkdtemp(path.join(tmpdir(), "yogurt-native-installer-"));
    try {
      await copyTree(application, path.join(staging, path.basename(application)));
      installer = path.join(output, `Yogurt Manager Native-${metadata.version}-arm64.dmg`);
      await run("/usr/bin/hdiutil", ["create", "-volname", "Yogurt Manager Native", "-fs", "HFS+", "-format", "UDZO", "-ov", "-srcfolder", staging, installer]);
      await run("/usr/bin/hdiutil", ["verify", installer]);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  console.log(`Native Swift application staged and verified: ${application}`);
  console.log(identity === "-" ? "Signed ad-hoc: each update will ask for Keychain access again." : "Signed with a certificate identity: Keychain access carries over to later builds.");
  if (installer) console.log(`Native installer: ${installer}`);
  return { application, installer, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const allowed = new Set(["--dmg", "--sign"]);
  if (args.some((arg, index) => arg.startsWith("--") && !allowed.has(arg) || arg === "--sign" && (!args[index + 1] || args[index + 1].startsWith("--")))) {
    console.error("Usage: node scripts/build-native.mjs [--sign <identity hash, or - for ad-hoc>] [--dmg]");
    process.exitCode = 1;
  } else buildNative({ dmg: args.includes("--dmg"), signingIdentity: option("--sign") }).catch(error => { console.error(`Native packaging failed: ${error.message}`); process.exitCode = 1; });
}
