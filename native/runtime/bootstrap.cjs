"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Load the existing CommonJS backend only after private bootstrap validation. */

const path = require("node:path");
const fs = require("node:fs");
const rawWrite = process.stdout.write.bind(process.stdout);
const MAX_FRAME = 65536;
let buffer = "", started = false, stopping = false, ready = false;
const emit = (type, code) => rawWrite(`${JSON.stringify({ version: 1, type, ...(code ? { code } : {}) })}\n`);
// Third-party startup/database diagnostics can contain connection strings.
function discardDiagnostic(_bytes, encoding, callback) {
  const complete = typeof encoding === "function" ? encoding : callback;
  if (typeof complete === "function") queueMicrotask(complete);
  return true;
}
process.stdout.write = discardDiagnostic;
process.stderr.write = discardDiagnostic;

function fail(code) {
  if (stopping) return;
  stopping = true;
  emit("failed", code);
  process.emit("disconnect");
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 25);
}
function stop() {
  if (stopping) return;
  stopping = true;
  process.emit("message", { type: "shutdown" });
  process.emit("disconnect");
  setTimeout(() => process.exit(0), 3000).unref();
  if (!started) process.exit(0);
}

function databaseUrl(value) {
  if (typeof value !== "string" || value.length > 16384 || /[\s\u0000-\u001f]/.test(value)) throw Error("CONFIGURATION");
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && /^\/yogurt_e2e_[a-z0-9_]+$/.test(url.pathname);
  const remote = /^(?:db\.[a-z0-9-]+\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com)$/.test(url.hostname);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.hash
    || (!local && (!remote || !url.password || (url.port && !["5432", "6543"].includes(url.port))))) throw Error("CONFIGURATION");
  const allowed = new Set(["sslmode", "schema", "pgbouncer", "connection_limit", "pool_timeout", "connect_timeout", "socket_timeout", "statement_cache_size", "application_name"]);
  const seen = new Set();
  for (const [key] of url.searchParams) { if (!allowed.has(key) || seen.has(key)) throw Error("CONFIGURATION"); seen.add(key); }
  const mode = url.searchParams.get("sslmode");
  if ((!local && !["require", "verify-ca", "verify-full"].includes(mode)) || (local && mode && !["disable", "require", "verify-ca", "verify-full"].includes(mode))) throw Error("CONFIGURATION");
  decodeURIComponent(url.username); decodeURIComponent(url.password);
  return value;
}

function directory(directory, create = false) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) || directory.includes("\0")) throw Error("CONFIGURATION");
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (!create || error.code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 }); stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("CONFIGURATION");
  }
  if (create) {
    if (typeof process.getuid === "function" && fs.lstatSync(resolved).uid !== process.getuid()) throw Error("CONFIGURATION");
    fs.chmodSync(resolved, 0o700);
  }
  return resolved;
}

function bootstrap(frame) {
  if (!frame || frame.version !== 1 || frame.type !== "bootstrap" || frame.port !== 43188
    || Object.keys(frame).some(key => !["version", "type", "port", "appRoot", "dataRoot", "capability", "config"].includes(key))
    || typeof frame.capability !== "string" || !/^[A-Za-z0-9_-]{48,256}$/.test(frame.capability)
    || !frame.config || typeof frame.config !== "object" || Array.isArray(frame.config)
    || Object.keys(frame.config).some(key => !["DATABASE_URL", "DIRECT_URL", "SESSION_SECRET"].includes(key))
    || typeof frame.config.SESSION_SECRET !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(frame.config.SESSION_SECRET)) throw Error("CONFIGURATION");
  const connection = databaseUrl(frame.config.DATABASE_URL);
  const direct = frame.config.DIRECT_URL === undefined ? null : databaseUrl(frame.config.DIRECT_URL);
  const appRoot = directory(frame.appRoot);
  const dataRoot = directory(frame.dataRoot, true);
  const inherited = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[key]) inherited[key] = process.env[key];
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, inherited, { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: connection,
    ...(direct ? { DIRECT_URL: direct } : {}), SESSION_SECRET: frame.config.SESSION_SECRET,
    PORT: "43188", HOSTNAME: "127.0.0.1", INTERNAL_APP_ORIGIN: "http://127.0.0.1:43188",
    YOGURT_APP_ROOT: appRoot, YOGURT_DATA_ROOT: dataRoot, YOGURT_DESKTOP_TOKEN: frame.capability, YOGURT_PARENT_PID: String(process.ppid),
  });
  process.chdir(appRoot);
  process.send = message => {
    if (message?.type === "ready" && !ready) { ready = true; emit("ready"); }
    else if (message?.type === "failed") emit("failed", message.code === "PORT_BUSY" ? "PORT_BUSY" : "START_FAILED");
    return true;
  };
  started = true;
  require(path.join(appRoot, "desktop", "backend.cjs"));
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", bytes => {
  if (stopping) return;
  buffer += bytes;
  if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME) return fail(started ? "CONTROL_PROTOCOL" : "CONFIGURATION");
  let split;
  while ((split = buffer.indexOf("\n")) >= 0 && !stopping) {
    const line = buffer.slice(0, split); buffer = buffer.slice(split + 1);
    const wasStarted = started;
    try {
      const frame = JSON.parse(line);
      if (!started) bootstrap(frame);
      else if (frame?.version !== 1 || !["heartbeat", "shutdown"].includes(frame.type) || Object.keys(frame).some(key => !["version", "type"].includes(key))) fail("CONTROL_PROTOCOL");
      else if (frame.type === "shutdown") stop();
      else process.emit("message", { type: "heartbeat" });
    } catch { fail(wasStarted ? "CONTROL_PROTOCOL" : started ? "START_FAILED" : "CONFIGURATION"); }
  }
});
process.stdin.on("end", stop);
process.stdin.on("error", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("uncaughtException", () => fail("START_FAILED"));
process.on("unhandledRejection", () => fail("START_FAILED"));
setTimeout(() => { if (!started) fail("CONFIGURATION"); }, 10000).unref();
