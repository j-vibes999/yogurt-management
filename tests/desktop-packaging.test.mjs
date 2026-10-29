import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createBuildEnvironment, prepareBuildSources, scanPayload } from "../scripts/build-desktop.mjs";

const require = createRequire(import.meta.url);

test("desktop builds replace inherited credentials and public environment values", () => {
  const environment = createBuildEnvironment({ PATH: "/usr/bin", HOME: "/home/test", DATABASE_URL: "private", SESSION_SECRET: "private", NEXT_PUBLIC_TOKEN: "private", PGPASSWORD: "private", NODE_OPTIONS: "--require=private" });
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.DESKTOP_BUILD, "1");
  assert.equal(environment.NODE_ENV, "production");
  assert.match(environment.DATABASE_URL, /^postgresql:\/\/desktop_build:desktop_build@127\.0\.0\.1:1\/desktop_build/);
  assert.ok(environment.SESSION_SECRET.length >= 32);
  for (const name of ["NEXT_PUBLIC_TOKEN", "PGPASSWORD", "NODE_OPTIONS"]) assert.equal(environment[name], undefined);
});

test("desktop source whitelist excludes env files and private receipt data without changing originals", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "yogurt-desktop-package-"));
  const source = path.join(directory, "source");
  const destination = path.join(directory, "build with spaces");
  try {
    for (const file of ["package.json", "next.config.ts", "src/app/page.tsx", "app/page.tsx", "src/app/api/receipts/[name]/route.ts", "app/api/uploads/receipts/route.ts", "public/illustrations/yogurt.svg", ".env", ".env.production.local", "src/.env.local", ".yogurt/private-receipts/receipt.png", "public/uploads/receipts/receipt.png", "tests/private.test.mjs", "backup.dump"]) {
      await mkdir(path.dirname(path.join(source, file)), { recursive: true });
      await writeFile(path.join(source, file), file.startsWith(".env") ? "PRIVATE_SENTINEL" : "fixture");
    }
    await prepareBuildSources(source, destination);
    assert.equal(await readFile(path.join(destination, "src/app/page.tsx"), "utf8"), "fixture");
    assert.equal(await readFile(path.join(destination, "app/page.tsx"), "utf8"), "fixture");
    assert.equal(await readFile(path.join(destination, "src/app/api/receipts/[name]/route.ts"), "utf8"), "fixture");
    assert.equal(await readFile(path.join(destination, "app/api/uploads/receipts/route.ts"), "utf8"), "fixture");
    assert.equal(await readFile(path.join(destination, "public/illustrations/yogurt.svg"), "utf8"), "fixture");
    for (const file of [".env", ".env.production.local", "src/.env.local", ".yogurt/private-receipts/receipt.png", "public/uploads/receipts/receipt.png", "tests/private.test.mjs", "backup.dump"]) await assert.rejects(readFile(path.join(destination, file)), { code: "ENOENT" });
    assert.equal(await readFile(path.join(source, ".env"), "utf8"), "PRIVATE_SENTINEL");
    await scanPayload(destination);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("desktop source staging refuses symlinks that could escape its whitelist", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "yogurt-desktop-links-"));
  try {
    await mkdir(path.join(directory, "source/src"), { recursive: true });
    await writeFile(path.join(directory, "secret"), "PRIVATE_SENTINEL");
    await symlink(path.join(directory, "secret"), path.join(directory, "source/src/leak.ts"));
    await assert.rejects(prepareBuildSources(path.join(directory, "source"), path.join(directory, "destination")), /symlink/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("payload scans reject credential-bearing content and forbidden private files without exposing values", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "yogurt-desktop-scan-"));
  try {
    await writeFile(path.join(directory, "server.js"), 'const database="postgresql://private_user:PRIVATE_SENTINEL@example.invalid/private";');
    await assert.rejects(scanPayload(directory), (error) => /credential/i.test(error.message) && !error.message.includes("PRIVATE_SENTINEL"));
    await rm(path.join(directory, "server.js"));
    await writeFile(path.join(directory, ".env"), "PRIVATE_SENTINEL");
    await assert.rejects(scanPayload(directory), (error) => /forbidden/i.test(error.message) && !error.message.includes("PRIVATE_SENTINEL"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("desktop resource mapping retains standalone dependencies and the native Prisma engine", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "yogurt-desktop-mapping-"));
  const files = [".next/required-server-files.json", "node_modules/next/package.json", "node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node"];
  try {
    for (const file of files) {
      const source = path.join(directory, "build/desktop/backend", file);
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, "bundled fixture");
    }
    const configuration = require("../electron-builder.config.cjs");
    // Exercise our file-set boundary using the same copier as electron-builder.
    const { getFileMatchers, copyFiles } = require("app-builder-lib/out/fileMatcher.js");
    const resources = path.join(directory, "output/Resources");
    const matchers = getFileMatchers(configuration, "extraResources", resources, { defaultSrc: directory, macroExpander: value => value, customBuildOptions: {}, globalOutDir: path.join(directory, "output") });
    await copyFiles(matchers);
    for (const file of files) assert.equal(await readFile(path.join(resources, "backend", file), "utf8"), "bundled fixture");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
