#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Used after restore/copy, including backups whose Prisma ledger already has this migration.
// Keep the URL out of argv and never relay libpq errors that might include connection secrets.
let database;
try {
  database = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("Invalid database protocol");
} catch {
  console.error("Database API hardening requires a PostgreSQL DATABASE_URL.");
  process.exit(1);
}
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PG")));
const connection = {
  PGHOST: database.hostname.replace(/^\[|\]$/g, ""), PGPORT: database.port,
  PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
};
const options = { host: "PGHOST", port: "PGPORT", user: "PGUSER", password: "PGPASSWORD", dbname: "PGDATABASE", sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", sslpassword: "PGSSLPASSWORD", channel_binding: "PGCHANNELBINDING", connect_timeout: "PGCONNECT_TIMEOUT", options: "PGOPTIONS", application_name: "PGAPPNAME", target_session_attrs: "PGTARGETSESSIONATTRS", gssencmode: "PGGSSENCMODE" };
const prismaOptions = new Set(["schema", "pgbouncer", "connection_limit", "pool_timeout", "socket_timeout", "statement_cache_size", "sslaccept"]);
for (const [option, value] of database.searchParams) {
  if (prismaOptions.has(option)) continue;
  if (!Object.hasOwn(options, option)) {
    console.error("Database API hardening received an unsupported connection option.");
    process.exit(1);
  }
  connection[options[option]] = value;
}
for (const [name, value] of Object.entries(connection)) if (value) env[name] = value;
const migration = readFileSync(new URL("../prisma/migrations/20261028090000_backend_api_isolation/migration.sql", import.meta.url), "utf8");
const result = spawnSync("psql", ["-X", "--no-password", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction"], {
  encoding: "utf8", input: migration, timeout: 60_000,
  env,
});
if (result.status !== 0) {
  console.error("Database API hardening failed. Check connectivity, backend ownership, and API role inheritance before retrying.");
  process.exit(1);
}
console.log("Application database API roles isolated; backend SQL ownership preserved.");
