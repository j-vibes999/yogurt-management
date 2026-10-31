import { createHash } from "node:crypto";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDesktop, createBuildEnvironment, run, scanPayload, verifyBackendPayload } from "./build-desktop.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NODE_VERSION = "v24.22.2";
const archiveName = `node-${NODE_VERSION}-darwin-arm64.tar.gz`;
const officialBase = `https://nodejs.org/dist/${NODE_VERSION}`;
// Pinned from the official HTTPS release manifest, 27 October 2026.
const officialArchiveSHA256 = "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function verifyArchiveAgainstManifest(bytes, manifest, name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid Node archive filename.");
  const matches = manifest.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(match => match && match[2] === name);
  if (matches.length !== 1 || sha256(bytes) !== matches[0][1]) throw new Error("Node archive checksum verification failed.");
  return matches[0][1];
}

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
async function download(url, limit) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
  if (!response.ok || (Number(response.headers.get("content-length")) || 0) > limit) throw new Error("Official Node runtime download failed.");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Official Node runtime download exceeded its limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function prepareOfficialNode(build, suppliedArchive) {
  const cache = path.join(build, "node-cache");
  await mkdir(cache, { recursive: true });
  const manifest = (await download(`${officialBase}/SHASUMS256.txt`, 1024 * 1024)).toString("utf8");
  const archivePath = suppliedArchive ? path.resolve(suppliedArchive) : path.join(cache, archiveName);
  let bytes;
  try { bytes = await readFile(archivePath); } catch (error) {
    if (suppliedArchive || error.code !== "ENOENT") throw error;
    bytes = await download(`${officialBase}/${archiveName}`, 128 * 1024 * 1024);
  }
  const digest = verifyArchiveAgainstManifest(bytes, manifest, archiveName);
  if (digest !== officialArchiveSHA256) throw new Error("The official Node archive differs from the pinned release.");
  if (!suppliedArchive) await writeFile(archivePath, bytes);
  const extracted = path.join(cache, "extracted");
  await rm(extracted, { recursive: true, force: true }); await mkdir(extracted);
  // Extract the same immutable byte snapshot that was verified, including when
  // the caller supplied an archive that could change concurrently.
  const verified = await mkdtemp(path.join(cache, "verified-"));
  try {
    const snapshot = path.join(verified, archiveName);
    await writeFile(snapshot, bytes, { mode: 0o600, flag: "wx" });
    await run("/usr/bin/tar", ["-xzf", snapshot, "-C", extracted, `node-${NODE_VERSION}-darwin-arm64/bin/node`, `node-${NODE_VERSION}-darwin-arm64/LICENSE`], { env: createBuildEnvironment() });
  } finally { await rm(verified, { recursive: true, force: true }); }
  const node = path.join(extracted, `node-${NODE_VERSION}-darwin-arm64/bin/node`);
  const identity = await captured(node, ["-p", "JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})"], { env: createBuildEnvironment() });
  if (identity !== JSON.stringify({ version: NODE_VERSION, arch: "arm64", platform: "darwin" })) throw new Error("Unexpected bundled Node runtime identity.");
  const libraries = (await captured("/usr/bin/otool", ["-L", node])).split("\n").slice(1).map(line => line.trim().split(" ")[0]).filter(Boolean);
  if (libraries.some(library => !library.startsWith("/usr/lib/") && !library.startsWith("/System/Library/"))) throw new Error("Bundled Node requires a non-system library.");
  return { node, license: path.join(extracted, `node-${NODE_VERSION}-darwin-arm64/LICENSE`), digest, manifest };
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

export async function buildNative({ nodeArchive, backend, dmg = false, signingIdentity } = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("The native package targets Apple Silicon macOS.");
  const build = path.join(repository, "build/native");
  await mkdir(build, { recursive: true });
  const environment = createBuildEnvironment();
  const runtime = await prepareOfficialNode(build, nodeArchive);
  if (!backend) await buildDesktop();
  const backendSource = backend ? path.resolve(backend) : path.join(repository, "build/desktop/backend");
  await verifyBackendPayload(backendSource);
  await run("/usr/bin/swift", ["build", "--package-path", path.join(repository, "native"), "--configuration", "release", "--arch", "arm64"], { cwd: repository, env: environment });
  const binaryDirectory = await captured("/usr/bin/swift", ["build", "--package-path", path.join(repository, "native"), "--configuration", "release", "--arch", "arm64", "--show-bin-path"], { cwd: repository, env: environment });
  const output = path.join(repository, "dist-native");
  const application = path.join(output, "Yogurt Manager Native.app");
  await rm(application, { recursive: true, force: true });
  const contents = path.join(application, "Contents");
  const resources = path.join(contents, "Resources");
  const helpers = path.join(contents, "Helpers");
  const executables = path.join(contents, "MacOS");
  await Promise.all([mkdir(path.join(resources, "runtime"), { recursive: true }), mkdir(helpers, { recursive: true }), mkdir(executables, { recursive: true })]);
  await copyFile(path.join(binaryDirectory, "YogurtNative"), path.join(executables, "YogurtNative"));
  const bundles = (await readdir(binaryDirectory)).filter(name => name.startsWith("YogurtNative_") && (name.endsWith(".bundle") || name.endsWith(".resources")));
  if (!bundles.length) throw new Error("The native Swift resource bundle is missing.");
  for (const name of bundles) {
    await copyTree(path.join(binaryDirectory, name), path.join(resources, name));
    await copyTree(path.join(binaryDirectory, name), path.join(executables, name));
    // The generated Darwin accessor checks Bundle.main.resourceURL; the MacOS copy
    // also supports command-line-style executable-relative bundle resolution.
  }
  await run("/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-mmacosx-version-min=15.0", path.join(repository, "native/runtime/supervisor.c"), "-o", path.join(helpers, "yogurt-supervisor")], { env: environment });
  await Promise.all([
    copyFile(runtime.node, path.join(resources, "runtime/node")),
    copyFile(runtime.license, path.join(resources, "runtime/NODE-LICENSE")),
    copyFile(path.join(repository, "native/runtime/bootstrap.cjs"), path.join(resources, "runtime/bootstrap.cjs")),
    copyTree(backendSource, path.join(resources, "backend")),
  ]);
  await mkdir(path.join(resources, "backend/desktop"), { recursive: true });
  for (const name of ["backend.cjs", "local-server.cjs"]) await copyFile(path.join(repository, "desktop", name), path.join(resources, "backend/desktop", name));
  const metadata = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  const plist = (await readFile(path.join(repository, "native/Info.plist"), "utf8")).replaceAll("__VERSION__", metadata.version);
  await writeFile(path.join(contents, "Info.plist"), plist);
  await makeIcon(build, resources);
  await Promise.all([chmod(path.join(executables, "YogurtNative"), 0o755), chmod(path.join(helpers, "yogurt-supervisor"), 0o755), chmod(path.join(resources, "runtime/node"), 0o755)]);
  await run("/usr/bin/plutil", ["-lint", path.join(contents, "Info.plist")]);
  await verifyBackendPayload(path.join(resources, "backend"));
  await scanPayload(application);
  const identity = chooseSigningIdentity(await captured("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]), signingIdentity);
  await run("/usr/bin/codesign", ["--force", "--deep", "--timestamp=none", "--sign", identity, application]);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", application]);
  const manifest = { version: 1, signing: identity === "-" ? "ad-hoc" : "certificate", nodeVersion: NODE_VERSION, officialArchive: archiveName, archiveSHA256: runtime.digest,
    nodeSHA256: sha256(await readFile(path.join(resources, "runtime/node"))), supervisorSHA256: sha256(await readFile(path.join(helpers, "yogurt-supervisor"))),
    backendBuildId: (await readFile(path.join(resources, "backend/.next/BUILD_ID"), "utf8")).trim(),
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
  console.log(`Native application staged and verified: ${application}`);
  console.log(identity === "-" ? "Signed ad-hoc: each update will ask for Keychain access again." : "Signed with a certificate identity: Keychain access carries over to later builds.");
  if (installer) console.log(`Native installer: ${installer}`);
  return { application, installer, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const allowed = new Set(["--node-archive", "--backend", "--dmg", "--sign"]);
  if (args.some((arg, index) => arg.startsWith("--") && !allowed.has(arg) || ["--node-archive", "--backend", "--sign"].includes(arg) && (!args[index + 1] || args[index + 1].startsWith("--")))) {
    console.error("Usage: node scripts/build-native.mjs [--node-archive <official tar.gz>] [--backend <verified backend directory>] [--sign <identity hash, or - for ad-hoc>] [--dmg]");
    process.exitCode = 1;
  } else buildNative({ nodeArchive: option("--node-archive"), backend: option("--backend"), dmg: args.includes("--dmg"), signingIdentity: option("--sign") }).catch(() => { console.error("Native packaging failed; no application was launched or installed."); process.exitCode = 1; });
}
