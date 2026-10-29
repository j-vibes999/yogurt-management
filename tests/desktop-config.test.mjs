import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importConfiguration, loadConfiguration } from "../desktop/config.cjs";

const databaseUrl = "postgresql://postgres.test-project:synthetic-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require";

// The filesystem is real. Only the OS Keychain boundary is replaced with an
// authenticated cipher using a fresh test key and Electron's async API shape.
function encryptionAdapter() {
  const key = randomBytes(32);
  return {
    async isAsyncEncryptionAvailable() { return true; },
    async encryptStringAsync(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
    },
    async decryptStringAsync(bytes) {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      const value = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
      return { result: value.toString("utf8"), shouldReEncrypt: false };
    },
  };
}

async function fixture(t, contents = `DATABASE_URL="${databaseUrl}"\n`) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "yogurt-desktop-config-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const envPath = path.join(root, "synthetic.env");
  await writeFile(envPath, contents, { mode: 0o600 });
  return { root, directory: path.join(root, "userData"), envPath, safeStorage: encryptionAdapter() };
}

async function configFile(directory) {
  const names = await readdir(directory);
  assert.equal(names.length, 1);
  return path.join(directory, names[0]);
}

test("absent desktop configuration returns null without requesting Keychain access", async (t) => {
  const options = await fixture(t);
  options.safeStorage.isAsyncEncryptionAvailable = async () => { throw new Error("Keychain should stay idle"); };
  assert.equal(await loadConfiguration(options), null);
  await assert.rejects(lstat(options.directory), { code: "ENOENT" });
});

test("configuration import persists only ciphertext with private filesystem permissions", async (t) => {
  const options = await fixture(t, `IGNORED_SECRET=must-not-be-imported\nSESSION_SECRET=must-not-be-used\nexport DATABASE_URL='${databaseUrl}' # connection\n`);
  const imported = await importConfiguration(options);
  assert.equal(imported.databaseUrl, databaseUrl);
  assert.match(imported.sessionSecret, /^[A-Za-z0-9_-]{64}$/);
  const file = await configFile(options.directory);
  const persisted = await readFile(file);
  for (const privateValue of [databaseUrl, imported.sessionSecret, "must-not-be-imported", "must-not-be-used"]) {
    assert.equal(persisted.includes(Buffer.from(privateValue)), false);
  }
  assert.equal((await lstat(options.directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await loadConfiguration(options), imported);
});

test("reimport changes the connection while retaining the generated session secret", async (t) => {
  const options = await fixture(t);
  const first = await importConfiguration(options);
  const replacement = "postgresql://postgres:second-synthetic-password@db.test-project.supabase.co:5432/postgres?sslmode=verify-full";
  await writeFile(options.envPath, `DATABASE_URL=${replacement}\n`);
  const second = await importConfiguration(options);
  assert.equal(second.databaseUrl, replacement);
  assert.equal(second.sessionSecret, first.sessionSecret);
  assert.deepEqual(await loadConfiguration(options), second);
  assert.equal((await readdir(options.directory)).length, 1);
});

test("unavailable or denied encryption never writes a plaintext fallback", async (t) => {
  const options = await fixture(t);
  options.safeStorage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(importConfiguration(options), (error) => !error.message.includes(databaseUrl));
  assert.deepEqual(await readdir(options.directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error)), []);
  options.safeStorage.isAsyncEncryptionAvailable = async () => true;
  options.safeStorage.encryptStringAsync = async () => { throw new Error(databaseUrl); };
  await assert.rejects(importConfiguration(options), (error) => !error.message.includes(databaseUrl));
  assert.deepEqual(await readdir(options.directory), []);
});

test("a failed reimport leaves the previous encrypted configuration intact", async (t) => {
  const options = await fixture(t);
  const original = await importConfiguration(options);
  const file = await configFile(options.directory);
  const before = await readFile(file);
  const available = options.safeStorage.encryptStringAsync;
  options.safeStorage.encryptStringAsync = async () => { throw new Error("synthetic Keychain denial"); };
  await assert.rejects(importConfiguration(options));
  assert.deepEqual(await readFile(file), before);
  options.safeStorage.encryptStringAsync = available;
  assert.deepEqual(await loadConfiguration(options), original);
});

test("corrupt ciphertext and malformed decrypted data produce generic errors", async (t) => {
  const options = await fixture(t);
  await importConfiguration(options);
  const file = await configFile(options.directory);
  await writeFile(file, Buffer.from("corrupt-synthetic-ciphertext"));
  await assert.rejects(loadConfiguration(options), (error) => !/cipher|authenticate|synthetic/.test(error.message));
  options.safeStorage.decryptStringAsync = async () => ({ result: `not-json:${databaseUrl}`, shouldReEncrypt: false });
  await assert.rejects(loadConfiguration(options), (error) => !error.message.includes(databaseUrl));
  options.safeStorage.decryptStringAsync = async () => ({ result: JSON.stringify({ version: 1, databaseUrl, sessionSecret: "short" }), shouldReEncrypt: false });
  await assert.rejects(loadConfiguration(options));
  await assert.rejects(importConfiguration(options));
});

test("configuration loads reencrypt a rotated Keychain result without changing credentials", async (t) => {
  const options = await fixture(t);
  const imported = await importConfiguration(options);
  const file = await configFile(options.directory);
  const before = await readFile(file);
  const decrypt = options.safeStorage.decryptStringAsync;
  options.safeStorage.decryptStringAsync = async (bytes) => ({ ...(await decrypt(bytes)), shouldReEncrypt: true });
  assert.deepEqual(await loadConfiguration(options), imported);
  assert.notDeepEqual(await readFile(file), before);
});

test("loading existing configuration restores owner-only file and directory modes", async (t) => {
  const options = await fixture(t);
  const imported = await importConfiguration(options);
  const file = await configFile(options.directory);
  await chmod(options.directory, 0o755);
  await chmod(file, 0o644);
  assert.deepEqual(await loadConfiguration(options), imported);
  assert.equal((await lstat(options.directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
});

test("environment import rejects ambiguous, non-Supabase, and non-TLS connections", async (t) => {
  const options = await fixture(t);
  const invalidInputs = [
    "SESSION_SECRET=ignored\n",
    `DATABASE_URL=${databaseUrl}\nDATABASE_URL=${databaseUrl}\n`,
    `DATABASE_URL="${databaseUrl}\n`,
    `DATABASE_URL=${databaseUrl.replace("postgresql:", "https:")}\n`,
    `DATABASE_URL=${databaseUrl.replace("pooler.supabase.com", "pooler.supabase.com.example.test")}\n`,
    `DATABASE_URL=${databaseUrl.replace("sslmode=require", "sslmode=disable")}\n`,
    `DATABASE_URL=${databaseUrl.replace("&sslmode=require", "")}\n`,
    `DATABASE_URL=${databaseUrl}&sslmode=disable\n`,
    `DATABASE_URL=${databaseUrl}&host=example.test\n`,
    `DATABASE_URL=${databaseUrl.replace(":synthetic-password@", "@")}\n`,
  ];
  for (const contents of invalidInputs) {
    await writeFile(options.envPath, contents);
    await assert.rejects(importConfiguration(options), (error) => !error.message.includes("postgresql:"));
  }
});

test("configuration and selected input refuse symlinks and conflicting directory entries", async (t) => {
  const options = await fixture(t);
  const imported = await importConfiguration(options);
  const file = await configFile(options.directory);
  const target = path.join(options.root, "original-ciphertext");
  await writeFile(target, await readFile(file));
  await rm(file);
  await symlink(target, file);
  await assert.rejects(loadConfiguration(options));
  await assert.rejects(importConfiguration(options));
  await rm(file);
  await mkdir(file);
  await assert.rejects(importConfiguration(options));
  const sourceLink = path.join(options.root, "selected-link.env");
  await symlink(options.envPath, sourceLink);
  await assert.rejects(importConfiguration({ ...options, directory: path.join(options.root, "other"), envPath: sourceLink }));
  const directoryLink = path.join(options.root, "linked-userData");
  await symlink(options.directory, directoryLink);
  await assert.rejects(loadConfiguration({ ...options, directory: directoryLink }));
  assert.equal(imported.databaseUrl, databaseUrl);
});

test("explicit local test mode accepts only loopback scratch database names", async (t) => {
  const localUrl = "postgresql://postgres@127.0.0.1:55473/yogurt_e2e_packaged_123";
  const options = await fixture(t, `DATABASE_URL=${localUrl}\n`);
  await assert.rejects(importConfiguration(options));
  const imported = await importConfiguration({ ...options, allowLocalTestDatabase: true });
  assert.equal(imported.databaseUrl, localUrl);
  assert.deepEqual(await loadConfiguration({ ...options, allowLocalTestDatabase: true }), imported);
  await assert.rejects(loadConfiguration(options));
  for (const invalidUrl of [
    "postgresql://postgres@127.0.0.1:55473/postgres",
    "postgresql://postgres@localhost:55473/yogurt_production",
    "postgresql://postgres@example.test:55473/yogurt_e2e_synthetic",
    "postgresql://postgres@127.0.0.1.example.test:55473/yogurt_e2e_synthetic",
    "postgresql://postgres@127.0.0.1:55473/yogurt_e2e_",
  ]) {
    await writeFile(options.envPath, `DATABASE_URL=${invalidUrl}\n`);
    await assert.rejects(importConfiguration({ ...options, allowLocalTestDatabase: true }));
  }
});

test("interrupted configuration publication preserves the previous encrypted file", async (t) => {
  const options = await fixture(t);
  const original = await importConfiguration(options);
  const file = await configFile(options.directory);
  const before = await readFile(file);
  const interrupted = t.mock.method(fs, "rename", async () => { throw new Error("synthetic interrupted publication"); });
  await assert.rejects(importConfiguration(options), (error) => !error.message.includes("synthetic"));
  interrupted.mock.restore();
  assert.deepEqual(await readFile(file), before);
  assert.deepEqual(await loadConfiguration(options), original);
  assert.equal((await readdir(options.directory)).length, 1);
});

async function interruptedFirstImport(t, options) {
  const unlink = fs.unlink.bind(fs);
  const interrupted = t.mock.method(fs, "unlink", async (filename) => {
    if (path.basename(filename).startsWith(".desktop-config.enc.")) throw new Error("synthetic process interruption after publication");
    return unlink(filename);
  });
  try { await assert.rejects(importConfiguration(options)); } finally { interrupted.mock.restore(); }
  const file = path.join(options.directory, "desktop-config.enc");
  assert.equal((await lstat(file)).nlink, 2);
  assert.equal((await readdir(options.directory)).length, 2);
  return file;
}

test("loading recovers a first import interrupted after publishing its encrypted inode", async (t) => {
  const options = await fixture(t);
  const file = await interruptedFirstImport(t, options);
  const before = await readFile(file);
  const loaded = await loadConfiguration(options);
  assert.equal(loaded.databaseUrl, databaseUrl);
  assert.match(loaded.sessionSecret, /^[A-Za-z0-9_-]{64}$/);
  assert.deepEqual(await readFile(file), before);
  assert.equal((await lstat(file)).nlink, 1);
  assert.deepEqual(await readdir(options.directory), ["desktop-config.enc"]);
  assert.deepEqual(await loadConfiguration(options), loaded);
});

test("reimport recovers an interrupted first publication while preserving its generated session secret", async (t) => {
  const options = await fixture(t);
  const file = await interruptedFirstImport(t, options);
  const previous = JSON.parse((await options.safeStorage.decryptStringAsync(await readFile(file))).result);
  const replacement = "postgresql://postgres:replacement-synthetic-password@db.test-project.supabase.co:5432/postgres?sslmode=require";
  await writeFile(options.envPath, `DATABASE_URL=${replacement}\n`);
  const imported = await importConfiguration(options);
  assert.equal(imported.databaseUrl, replacement);
  assert.equal(imported.sessionSecret, previous.sessionSecret);
  assert.equal((await lstat(file)).nlink, 1);
  assert.deepEqual(await readdir(options.directory), ["desktop-config.enc"]);
});

test("arbitrary hardlinks and imitation temporary entries are refused without cleanup", async (t) => {
  const options = await fixture(t);
  await importConfiguration(options);
  const file = await configFile(options.directory);
  const before = await readFile(file);
  const outside = path.join(options.root, "outside-hardlink");
  await fs.link(file, outside);
  const imitation = path.join(options.directory, ".desktop-config.enc.11111111-1111-4111-8111-111111111111.tmp");
  await writeFile(imitation, "unrelated staging bytes");
  await assert.rejects(loadConfiguration(options));
  await assert.rejects(importConfiguration(options));
  assert.deepEqual(await readFile(imitation), Buffer.from("unrelated staging bytes"));
  assert.deepEqual(await readFile(outside), before);
  await rm(imitation);
  await symlink(file, imitation);
  await assert.rejects(loadConfiguration(options));
  assert.equal((await lstat(imitation)).isSymbolicLink(), true);
  await rm(imitation);
  await rm(outside);
  const wrongName = path.join(options.directory, ".desktop-config.enc.not-a-uuid.tmp");
  await fs.link(file, wrongName);
  await assert.rejects(loadConfiguration(options));
  assert.equal((await lstat(wrongName)).nlink, 2);
});

test("a matching stale temporary link cannot hide an additional arbitrary hardlink", async (t) => {
  const options = await fixture(t);
  const file = await interruptedFirstImport(t, options);
  const outside = path.join(options.root, "outside-hardlink");
  await fs.link(file, outside);
  const names = (await readdir(options.directory)).sort();
  await assert.rejects(loadConfiguration(options));
  await assert.rejects(importConfiguration(options));
  assert.deepEqual((await readdir(options.directory)).sort(), names);
  assert.equal((await lstat(file)).nlink, 3);
});
