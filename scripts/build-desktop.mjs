import { constants } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const placeholderDatabase = "postgresql://desktop_build:desktop_build@127.0.0.1:1/desktop_build?sslmode=require";
const privateDirectories = new Set([".yogurt", "backups", "dumps", "private-receipts", "tests", "test", "__tests__"]);
const sourceInputs = ["app", "src", "public", "prisma/schema.prisma", "package.json", "next.config.ts", "next-env.d.ts", "tsconfig.json", "middleware.ts", "eslint.config.mjs"];

function forbidden(relative) {
  return /(?:^|\/)public\/uploads\/receipts(?:\/|$)/.test(relative.split(path.sep).join("/")) || relative.split(path.sep).some(part => part.startsWith(".env") || privateDirectories.has(part) || /(?:\.dump(?:\.|$)|\.bak$|\.receipts\.tar\.)/i.test(part));
}

export function createBuildEnvironment(inherited = process.env) {
  const environment = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]) if (inherited[name]) environment[name] = inherited[name];
  return { ...environment, NODE_ENV: "production", DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: placeholderDatabase, SESSION_SECRET: "desktop-build-placeholder-only-not-runtime-000000" };
}

async function copyAllowed(source, destination, { dependencies = false } = {}) {
  const sourceRoot = await realpath(source);
  await cp(sourceRoot, destination, {
    recursive: true, dereference: dependencies, mode: constants.COPYFILE_FICLONE,
    filter: async file => {
      if (forbidden(file)) return false;
      if (!dependencies && (await lstat(file)).isSymbolicLink()) throw new Error("Desktop staging refused a symlink.");
      return true;
    },
  });
}

export async function prepareBuildSources(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const input of sourceInputs) {
    const file = path.join(source, input);
    try { await lstat(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if ((await lstat(file)).isSymbolicLink()) throw new Error("Desktop staging refused a symlink.");
    await copyAllowed(file, path.join(destination, input));
  }
}

// Report only the path and finding category; credential contents never enter logs.
export async function scanPayload(directory) {
  let files = 0;
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const relative = path.relative(directory, file);
      if (forbidden(relative)) throw new Error(`Forbidden private file in desktop payload: ${relative}`);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in desktop payload: ${relative}`);
      if (entry.isDirectory()) { await walk(file); continue; }
      const contents = (await readFile(file)).toString("utf8");
      const urls = contents.match(/postgres(?:ql)?:\/\/[^\s"'`<>\\]+/gi) ?? [];
      if (urls.some(url => url !== placeholderDatabase && /:\/\/[^/@\s]+:[^/@\s]+@/.test(url)) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents)) throw new Error(`Credential-like content in desktop payload: ${relative}`);
      files += 1;
    }
  }
  await walk(directory);
  return { files };
}

export async function verifyBackendPayload(directory) {
  for (const file of [".next/BUILD_ID", ".next/required-server-files.json", ".next/static", "public", "node_modules/next/package.json", "node_modules/@prisma/client/package.json", "node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node"]) {
    try { await lstat(path.join(directory, file)); }
    catch { throw new Error(`Required desktop backend file is missing: ${file}`); }
  }
  const { config } = JSON.parse(await readFile(path.join(directory, ".next/required-server-files.json"), "utf8"));
  if (config.distDir !== ".next") throw new Error("Unexpected desktop backend build directory.");
  return scanPayload(directory);
}

export function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Desktop build command failed (${code ?? "signal"}).`)));
  });
}

export async function buildDesktop() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("This desktop build targets an Apple Silicon Mac.");
  const build = path.join(repository, "build", "desktop");
  const workspace = await mkdtemp(path.join(tmpdir(), "yogurt-desktop-build-"));
  const environment = createBuildEnvironment();
  await rm(build, { recursive: true, force: true });
  await mkdir(build, { recursive: true });
  try {
    console.log("Preparing an isolated desktop build with placeholder credentials.");
    await prepareBuildSources(repository, workspace);
    await copyAllowed(path.join(repository, "node_modules"), path.join(workspace, "node_modules"), { dependencies: true });
    await run(process.execPath, [path.join(workspace, "node_modules/prisma/build/index.js"), "generate", "--schema", "prisma/schema.prisma"], { cwd: workspace, env: environment });
    await run(process.execPath, [path.join(workspace, "node_modules/next/dist/bin/next"), "build"], { cwd: workspace, env: environment });

    const backend = path.join(build, "backend");
    const standalone = path.join(workspace, ".next", "standalone");
    for (const input of ["node_modules", ".next", "package.json"]) await copyAllowed(path.join(standalone, input), path.join(backend, input), { dependencies: true });
    await copyAllowed(path.join(workspace, ".next/static"), path.join(backend, ".next/static"));
    await copyAllowed(path.join(workspace, "public"), path.join(backend, "public"));
    await copyAllowed(path.join(workspace, ".next/required-server-files.json"), path.join(backend, ".next/required-server-files.json"));
    // Prisma's generated package and engine must remain ordinary files outside ASAR.
    for (const input of [".prisma/client", "@prisma/client"]) await copyAllowed(path.join(workspace, "node_modules", input), path.join(backend, "node_modules", input), { dependencies: true });
    await lstat(path.join(backend, "node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node"));

    const shell = path.join(build, "shell");
    const metadata = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
    await mkdir(path.join(shell, "desktop"), { recursive: true });
    for (const name of ["main.cjs", "backend.cjs", "local-server.cjs", "config.cjs", "import-receipts.cjs"]) await copyAllowed(path.join(repository, "desktop", name), path.join(shell, "desktop", name));
    await writeFile(path.join(shell, "package.json"), `${JSON.stringify({ name: metadata.name, version: metadata.version, private: true, main: "desktop/main.cjs", description: "Yogurt Manager desktop application", author: "Yogurt Manager" }, null, 2)}\n`);
    const backendScan = await verifyBackendPayload(backend);
    await scanPayload(shell);
    console.log(`Desktop backend staged and scanned (${backendScan.files} files).`);
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildDesktop().catch(error => { console.error(error.message); process.exitCode = 1; });
