"use strict";

const { randomBytes, randomUUID } = require("node:crypto");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const CONFIGURATION_FILE = "desktop-config.enc";
const CONFIGURATION_TEMPORARY_PATTERN = /^\.desktop-config\.enc\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/;
const MAX_CONFIGURATION_BYTES = 64 * 1024;
const MAX_ENVIRONMENT_BYTES = 1024 * 1024;
const connectionParameters = new Set([
  "sslmode", "schema", "pgbouncer", "connection_limit", "pool_timeout",
  "connect_timeout", "socket_timeout", "statement_cache_size", "application_name",
]);

function configurationError() {
  return new Error("Desktop configuration could not be accessed securely.");
}

// Walk supplied paths without following symlink components. Electron passes an
// absolute userData path; no relative working-directory state is trusted here.
async function directoryAt(directory, create = false, makePrivate = false) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw configurationError();
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let info;
    try { info = await fs.lstat(current); } catch (error) {
      if (!create || error.code !== "ENOENT") throw error;
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      info = await fs.lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw configurationError();
  }
  const info = await fs.lstat(resolved);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw configurationError();
  if (makePrivate) await fs.chmod(resolved, 0o700);
  return resolved;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function recoverInterruptedPublication(filename, handle, info) {
  // A first import has exactly two links only between exclusive publication
  // and temporary-file cleanup. Recover that state without accepting links
  // elsewhere or deleting unrelated files with similar names.
  if (info.nlink !== 2) throw configurationError();
  const directory = path.dirname(filename);
  const candidates = [];
  for (const name of await fs.readdir(directory)) {
    if (!CONFIGURATION_TEMPORARY_PATTERN.test(name)) continue;
    const temporary = path.join(directory, name);
    const candidate = await fs.lstat(temporary);
    if (candidate.isFile() && candidate.dev === info.dev && candidate.ino === info.ino) candidates.push(temporary);
  }
  if (candidates.length !== 1) throw configurationError();
  const current = await fs.lstat(filename);
  const temporary = await fs.lstat(candidates[0]);
  if (!current.isFile() || current.nlink !== 2 || !sameFile(current, info)
    || !temporary.isFile() || temporary.nlink !== 2 || !sameFile(temporary, info)) throw configurationError();
  await fs.unlink(candidates[0]);
  const recovered = await handle.stat();
  if (recovered.nlink !== 1 || !sameFile(recovered, info)
    || !sameFile(recovered, await fs.lstat(filename))) throw configurationError();
  return recovered;
}

async function readRegularFile(filename, maximum, makePrivate = false) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    let info = await handle.stat();
    if (!info.isFile() || info.size === 0 || info.size > maximum) throw configurationError();
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw configurationError();
    if (makePrivate && info.nlink !== 1) info = await recoverInterruptedPublication(filename, handle, info);
    if (makePrivate) await handle.chmod(0o600);
    const bytes = await handle.readFile();
    if (bytes.length > maximum || !sameFile(info, await handle.stat())) throw configurationError();
    return { bytes, info };
  } finally { await handle.close(); }
}

function validateDatabaseUrl(value, allowLocalTestDatabase = false) {
  if (typeof value !== "string" || value.length > 16 * 1024 || /[\s\u0000-\u001f]/.test(value)) throw configurationError();
  const connection = new URL(value);
  const localTest = allowLocalTestDatabase === true
    && ["127.0.0.1", "[::1]", "localhost"].includes(connection.hostname)
    && /^\/yogurt_e2e_[a-z0-9_]+$/.test(connection.pathname);
  if (!["postgres:", "postgresql:"].includes(connection.protocol)
    || !connection.username
    || !/^\/[A-Za-z0-9_-]+$/.test(connection.pathname)
    || connection.hash) throw configurationError();
  if (!localTest && (!connection.password || (connection.port && !["5432", "6543"].includes(connection.port))
    || !/^(?:db\.[a-z0-9-]+\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com)$/.test(connection.hostname))) throw configurationError();
  decodeURIComponent(connection.username);
  decodeURIComponent(connection.password);
  const modes = connection.searchParams.getAll("sslmode");
  if (localTest) {
    if (modes.length > 1 || (modes.length === 1 && !["disable", "require", "verify-ca", "verify-full"].includes(modes[0]))) throw configurationError();
  } else if (modes.length !== 1 || !["require", "verify-ca", "verify-full"].includes(modes[0])) throw configurationError();
  const seen = new Set();
  for (const [name] of connection.searchParams) {
    // Reject alternate hosts, TLS overrides, local key paths, and ambiguous
    // repeated parameters rather than passing unchecked libpq options along.
    if (!connectionParameters.has(name) || seen.has(name)) throw configurationError();
    seen.add(name);
  }
  return value;
}

function databaseUrlFromEnvironment(contents, allowLocalTestDatabase) {
  let databaseUrl;
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    if (databaseUrl !== undefined) throw configurationError();
    let value = match[1];
    if (value.startsWith("\"") || value.startsWith("'")) {
      const quote = value[0];
      const closing = value.indexOf(quote, 1);
      if (closing < 0 || !/^\s*(?:#.*)?$/.test(value.slice(closing + 1))) throw configurationError();
      value = value.slice(1, closing);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    databaseUrl = validateDatabaseUrl(value, allowLocalTestDatabase);
  }
  if (databaseUrl === undefined) throw configurationError();
  return databaseUrl;
}

async function requireEncryption(safeStorage) {
  if (!safeStorage || typeof safeStorage.isAsyncEncryptionAvailable !== "function"
    || typeof safeStorage.encryptStringAsync !== "function" || typeof safeStorage.decryptStringAsync !== "function"
    || !(await safeStorage.isAsyncEncryptionAvailable())) throw configurationError();
}

async function readConfiguration(safeStorage, directory, allowLocalTestDatabase) {
  const filename = path.join(directory, CONFIGURATION_FILE);
  let stored;
  try { stored = await readRegularFile(filename, MAX_CONFIGURATION_BYTES, true); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  await requireEncryption(safeStorage);
  const decrypted = await safeStorage.decryptStringAsync(stored.bytes);
  if (!decrypted || typeof decrypted.result !== "string" || typeof decrypted.shouldReEncrypt !== "boolean") throw configurationError();
  const value = JSON.parse(decrypted.result);
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1
    || Object.keys(value).sort().join(",") !== "databaseUrl,sessionSecret,version"
    || typeof value.sessionSecret !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(value.sessionSecret)) throw configurationError();
  validateDatabaseUrl(value.databaseUrl, allowLocalTestDatabase);
  return { value: { databaseUrl: value.databaseUrl, sessionSecret: value.sessionSecret }, info: stored.info, shouldReEncrypt: decrypted.shouldReEncrypt };
}

async function writeConfiguration(safeStorage, directory, value, expected) {
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify({ version: 1, ...value }));
  if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > MAX_CONFIGURATION_BYTES) throw configurationError();
  const filename = path.join(directory, CONFIGURATION_FILE);
  const temporary = path.join(directory, `.${CONFIGURATION_FILE}.${randomUUID()}.tmp`);
  let handle;
  try {
    await directoryAt(directory, false, true);
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(encrypted);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (expected) {
      const current = await fs.lstat(filename);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || !sameFile(current, expected)) throw configurationError();
      await fs.rename(temporary, filename);
    } else {
      // Exclusive publication prevents a first-import race from replacing a
      // configuration (or symlink) that appeared while Keychain was open.
      await fs.link(temporary, filename);
    }
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function loadConfiguration({ safeStorage, directory, allowLocalTestDatabase = false }) {
  try {
    let location;
    try { location = await directoryAt(directory, false, true); } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const stored = await readConfiguration(safeStorage, location, allowLocalTestDatabase);
    if (!stored) return null;
    if (stored.shouldReEncrypt) await writeConfiguration(safeStorage, location, stored.value, stored.info);
    return stored.value;
  } catch { throw configurationError(); }
}

async function importConfiguration({ safeStorage, directory, envPath, allowLocalTestDatabase = false }) {
  try {
    const location = await directoryAt(directory, true, true);
    await requireEncryption(safeStorage);
    const previous = await readConfiguration(safeStorage, location, allowLocalTestDatabase);
    if (typeof envPath !== "string" || !path.isAbsolute(envPath)) throw configurationError();
    await directoryAt(path.dirname(envPath));
    const { bytes } = await readRegularFile(envPath, MAX_ENVIRONMENT_BYTES);
    const value = {
      databaseUrl: databaseUrlFromEnvironment(bytes.toString("utf8"), allowLocalTestDatabase),
      sessionSecret: previous?.value.sessionSecret ?? randomBytes(48).toString("base64url"),
    };
    await writeConfiguration(safeStorage, location, value, previous?.info);
    return value;
  } catch { throw configurationError(); }
}

module.exports = { loadConfiguration, importConfiguration };
