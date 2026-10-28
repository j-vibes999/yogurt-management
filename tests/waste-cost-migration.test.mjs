import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const binary = spawnSync("which", ["psql"], { encoding: "utf8" }).stdout.trim();
const pgBin = process.env.SECURITY_TEST_PG_BIN ?? dirname(binary);
const available = ["initdb", "pg_ctl", "psql"].every(name => existsSync(join(pgBin, name)));

test("corrective migration marks legacy returns unknown and recovers linked write-off costs without rewriting modern zero-cost records", { skip: available ? false : "PostgreSQL test binaries unavailable" }, () => {
  const work = mkdtempSync(join(tmpdir(), "yg-waste-"));
  const socket = join(work, "socket"); mkdirSync(socket);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PG"))), PGHOST: socket, PGPORT: "5432", PGUSER: "backend", PGDATABASE: "postgres", PGSSLMODE: "disable" };
  const run = (name, args, input) => spawnSync(join(pgBin, name), args, { env, input, encoding: "utf8", timeout: 30_000 });
  let started = false;
  try {
    const init = run("initdb", ["-D", join(work, "data"), "-U", "backend", "--auth=trust", "--no-locale"]);
    assert.equal(init.status, 0, init.stderr);
    const start = run("pg_ctl", ["-D", join(work, "data"), "-l", join(work, "server.log"), "-o", `-h '' -k '${socket}' -p 5432`, "-w", "start"]);
    assert.equal(start.status, 0, start.stderr); started = true;
    const migration = readFileSync(new URL("../prisma/migrations/20261028091000_historical_waste_provenance/migration.sql", import.meta.url), "utf8");
    const result = run("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], `
      CREATE TABLE _prisma_migrations (migration_name text, started_at timestamptz, finished_at timestamptz, rolled_back_at timestamptz);
      INSERT INTO _prisma_migrations VALUES ('20261013150000_waste_cost_tracking','2026-10-14T06:39:57Z','2026-10-14T06:39:58Z',NULL);
      CREATE TABLE restock_visits (id text PRIMARY KEY, created_at timestamp);
      CREATE TABLE restock_visit_items (id text PRIMARY KEY, restock_visit_id text, count_expired_returned int, expired_cost numeric, expired_unknown_units int);
      INSERT INTO restock_visits VALUES ('old','2026-10-13'),('new','2026-10-15');
      INSERT INTO restock_visit_items VALUES ('legacy','old',4,0,0),('priced','old',2,3.50,0),('modern-free','new',5,0,0),('modern-unknown','new',3,0,3);
      CREATE TABLE production_batches (id text PRIMARY KEY, unit_cost numeric, cost_known boolean);
      INSERT INTO production_batches VALUES ('known',12.34,true),('free',0,true),('unknown',0,false);
      CREATE TABLE finished_goods_adjustments (id text PRIMARY KEY, production_batch_id text, created_at timestamp, unit_cost numeric, cost_known boolean);
      INSERT INTO finished_goods_adjustments VALUES ('old-priced','known','2026-10-13',0,false),('old-free','free','2026-10-13',0,false),('old-unknown','unknown','2026-10-13',0,false),('modern','known','2026-10-15',7,true);
      ${migration}
      ${migration}
      SELECT id||':'||expired_cost||':'||expired_unknown_units FROM restock_visit_items ORDER BY id;
      SELECT id||':'||unit_cost||':'||cost_known FROM finished_goods_adjustments ORDER BY id;
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), ["legacy:0:4", "modern-free:0:0", "modern-unknown:0:3", "priced:3.50:0", "modern:7:true", "old-free:0:true", "old-priced:12.34:true", "old-unknown:0:false"].join("\n"));
  } finally {
    if (started) run("pg_ctl", ["-D", join(work, "data"), "-m", "immediate", "-w", "stop"]);
    rmSync(work, { recursive: true, force: true });
  }
});
