import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const pgBin = process.env.SECURITY_TEST_PG_BIN ?? dirname(spawnSync("which", ["psql"], { encoding: "utf8" }).stdout.trim());
const available = ["initdb", "pg_ctl", "psql"].every(name => existsSync(join(pgBin, name)));

test("recovered history normalizes only known checksums with matching schema and defaults", { skip: available ? false : "PostgreSQL test binaries unavailable" }, () => {
  const work = mkdtempSync(join(tmpdir(), "yg-history-"));
  const socket = join(work, "socket"); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PG"))), PGHOST: socket, PGPORT: "5432", PGUSER: "backend", PGDATABASE: "postgres", PGSSLMODE: "disable" };
  const run = (name, args, input) => spawnSync(join(pgBin, name), args, { env, input, encoding: "utf8", timeout: 30_000 });
  const sql = source => run("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], source);
  let started = false;
  try {
    const init = run("initdb", ["-D", join(work, "data"), "-U", "backend", "--auth=trust", "--no-locale"]); assert.equal(init.status, 0, init.stderr);
    const start = run("pg_ctl", ["-D", join(work, "data"), "-l", join(work, "server.log"), "-o", `-h '' -k '${socket}' -p 5432`, "-w", "start"]); assert.equal(start.status, 0, start.stderr); started = true;
    const migrationRoot = new URL("../prisma/migrations/", import.meta.url);
    const oldSchema = readdirSync(migrationRoot).filter(name => /^20/.test(name) && name < "20261028").sort().map(name => readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8")).join("\n");
    const setup = sql(`${oldSchema}
      CREATE TABLE _prisma_migrations (migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz);
      INSERT INTO _prisma_migrations VALUES
        ('20261013140000_auth_sessions_lockout','0c4d94a2d96ff9b6663f19fcc103d1c0887ddd5a917403afedeae2f517350a86',now(),NULL),
        ('20261013150000_waste_cost_tracking','2abf5ca7ec82b7c0959f1ae2afbcaa27d79492b0358f9f4c625bbc27394f1cd4',now(),NULL);`);
    assert.equal(setup.status, 0, setup.stderr);
    const migration = readFileSync(new URL("20261028092000_reconcile_recovered_history/migration.sql", migrationRoot), "utf8");
    const valid = sql(`BEGIN; ${migration} ${migration} SELECT checksum FROM _prisma_migrations ORDER BY migration_name; ROLLBACK;`);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout.trim(), "1a027ef1a528ffa75cca6252da44b321ca9bec2a0236a8bab18fd5654516b985\nffe6b368e95907b36441f3e9e858fb19643b0cd05e33a393a6d570d29a65a007");
    for (const mutation of [
      "UPDATE _prisma_migrations SET checksum='unexpected-history' WHERE migration_name='20261013140000_auth_sessions_lockout';",
      "ALTER TABLE users ALTER failed_login_count SET DEFAULT 99;",
      "ALTER TABLE finished_goods_adjustments ALTER unit_cost TYPE numeric(14,2);",
      "ALTER TABLE restock_visit_items DROP CONSTRAINT restock_expired_cost_check;",
    ]) {
      const rejected = sql(`BEGIN; ${mutation} ${migration} COMMIT;`);
      assert.notEqual(rejected.status, 0, `must reject changed recovered history/schema: ${mutation}`);
      assert.match(rejected.stderr, /Unrecognized migration checksum|schema does not match/);
      const unchanged = sql("SELECT checksum FROM _prisma_migrations WHERE migration_name='20261013140000_auth_sessions_lockout';");
      assert.equal(unchanged.stdout.trim(), "0c4d94a2d96ff9b6663f19fcc103d1c0887ddd5a917403afedeae2f517350a86", "the whole failed reconciliation must roll back");
    }
  } finally {
    if (started) run("pg_ctl", ["-D", join(work, "data"), "-m", "immediate", "-w", "stop"]);
    rmSync(work, { recursive: true, force: true });
  }
});
