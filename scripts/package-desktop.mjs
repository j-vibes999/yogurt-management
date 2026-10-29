import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildDesktop, createBuildEnvironment, run, scanPayload, verifyBackendPayload } from "./build-desktop.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function packageDesktop() {
  const environment = { ...createBuildEnvironment(), CSC_IDENTITY_AUTO_DISCOVERY: "false" };
  // Electron 45's npm package does not install its binary automatically.
  // Its installer is idempotent and also repairs an absent/partial installation.
  await run(process.execPath, [path.join(repository, "node_modules/electron/install.js")], { cwd: repository, env: environment });
  await buildDesktop();
  const build = path.join(repository, "build", "desktop");
  const iconset = path.join(build, "Yogurt.iconset");
  await mkdir(iconset);
  const icon = await readFile(path.join(repository, "desktop", "icon.svg"));
  for (const size of [16, 32, 128, 256, 512]) {
    await sharp(icon).resize(size, size).png().toFile(path.join(iconset, `icon_${size}x${size}.png`));
    await sharp(icon).resize(size * 2, size * 2).png().toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  await run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(build, "icon.icns")]);
  await rm(iconset, { recursive: true });
  await run(process.execPath, [path.join(repository, "node_modules/electron-builder/out/cli/cli.js"), "--config", "electron-builder.config.cjs", "--mac", "--dir", "--arm64", "--publish", "never"], { cwd: repository, env: environment });
  const applicationDirectory = path.join(repository, "dist-desktop", "mac-arm64");
  const resources = path.join(applicationDirectory, "Yogurt Manager.app", "Contents", "Resources");
  await verifyBackendPayload(path.join(resources, "backend"));
  const { extractAll } = await import("@electron/asar");
  const extracted = path.join(build, "verified-asar");
  extractAll(path.join(resources, "app.asar"), extracted);
  try {
    const entries = (await readdir(extracted)).sort();
    if (entries.join(",") !== "desktop,package.json") throw new Error("Unexpected files in desktop shell archive.");
    await scanPayload(extracted);
  } finally { await rm(extracted, { recursive: true, force: true }); }
  // macOS already provides the image builder; no additional downloaded DMG helper is needed.
  const metadata = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  const installer = path.join(repository, "dist-desktop", `Yogurt Manager-${metadata.version}-arm64.dmg`);
  await symlink("/Applications", path.join(applicationDirectory, "Applications"));
  await run("/usr/bin/hdiutil", ["create", "-volname", "Yogurt Manager", "-fs", "HFS+", "-format", "UDZO", "-ov", "-srcfolder", applicationDirectory, installer]);
  await run("/usr/bin/hdiutil", ["verify", installer]);
  console.log(`Packaged payload scanned. Installer: ${installer}`);
}

packageDesktop().catch(error => { console.error(error.message); process.exitCode = 1; });
