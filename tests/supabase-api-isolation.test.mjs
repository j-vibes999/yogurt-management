import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const migration = readFileSync(new URL("../prisma/migrations/20261028090000_backend_api_isolation/migration.sql", import.meta.url), "utf8");
// A private socket-only cluster keeps fixture roles/default ACLs off every existing database.
const psqlPath = spawnSync("which", ["psql"], { encoding: "utf8" }).stdout.trim();
const pgBin = process.env.SECURITY_TEST_PG_BIN ?? dirname(psqlPath);
const available = ["initdb", "pg_ctl", "psql"].every(binary => existsSync(join(pgBin, binary)));
let work;
let env;
function command(binary, args, input) {
  return spawnSync(join(pgBin, binary), args, { encoding: "utf8", env, input, timeout: 30_000 });
}
function sql(input) {
  const result = command("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], input);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

before(() => {
  if (!available) return;
  work = mkdtempSync(join(tmpdir(), "yg-api-"));
  mkdirSync(join(work, "socket"));
  env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("PG"))), PGHOST: join(work, "socket"), PGPORT: "5432", PGUSER: "backend", PGDATABASE: "postgres", PGSSLMODE: "disable" };
  const initialized = command("initdb", ["-D", join(work, "data"), "-U", "backend", "--auth=trust", "--no-locale"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const started = command("pg_ctl", ["-D", join(work, "data"), "-l", join(work, "server.log"), "-o", `-h '' -k '${env.PGHOST}' -p 5432`, "-w", "start"]);
  assert.equal(started.status, 0, started.stderr);
});

after(() => {
  if (!work) return;
  command("pg_ctl", ["-D", join(work, "data"), "-m", "immediate", "-w", "stop"]);
  rmSync(work, { recursive: true, force: true });
});

const pgTest = (name, fn) => test(name, { skip: available ? false : "PostgreSQL initdb/pg_ctl/psql unavailable; set SECURITY_TEST_PG_BIN" }, fn);

pgTest("isolation migration supports local PostgreSQL without Supabase roles and preserves owner writes", () => {
  const result = sql(`BEGIN;
    CREATE TABLE public.users (id integer PRIMARY KEY, name text);
    INSERT INTO public.users VALUES (1, 'original');
    ${migration}
    UPDATE public.users SET name = 'owner update' WHERE id = 1;
    SELECT relrowsecurity::text || ':' || name FROM pg_class JOIN public.users ON true WHERE oid = 'public.users'::regclass;
    ROLLBACK;`);
  assert.equal(result, "true:owner update");
});

pgTest("a local non-superuser owner can harden its own tables without membership in the postgres admin role", () => {
  const result = sql(`BEGIN;
    CREATE ROLE postgres;
    CREATE ROLE local_owner;
    GRANT USAGE, CREATE ON SCHEMA public TO local_owner;
    SET ROLE local_owner;
    CREATE TABLE public.users (id integer PRIMARY KEY, name text);
    ${migration}
    INSERT INTO public.users VALUES (1, 'owner insert');
    SELECT relrowsecurity::text || ':' || name FROM pg_class JOIN public.users ON true WHERE oid = 'public.users'::regclass;
    RESET ROLE;
    ROLLBACK;`);
  assert.equal(result, "true:owner insert");
});

pgTest("API roles lose table, column, sequence and function access while owners and managed objects work", () => {
  const result = sql(`BEGIN;
    CREATE ROLE postgres;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE managed;
    GRANT USAGE, CREATE ON SCHEMA public TO postgres;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id integer);
    GRANT SELECT ON auth.users TO anon;
    SET ROLE postgres;
    CREATE TABLE public.users (id serial PRIMARY KEY, name text);
    CREATE TABLE public._prisma_migrations (id text);
    CREATE TABLE public.daily_closings (id text);
    CREATE TABLE public.unrelated (id integer);
    INSERT INTO public.users (name) VALUES ('owner');
    CREATE FUNCTION public.app_read() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT count(*)::integer FROM public.users';
    GRANT ALL ON public.users, public._prisma_migrations, public.daily_closings TO anon, authenticated, PUBLIC;
    GRANT SELECT (name), UPDATE (name) ON public.users TO anon, authenticated, PUBLIC;
    GRANT ALL ON SEQUENCE public.users_id_seq TO anon, authenticated, PUBLIC;
    GRANT EXECUTE ON FUNCTION public.app_read() TO anon, authenticated;
    GRANT SELECT ON public.unrelated TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, PUBLIC;
    RESET ROLE;
    CREATE EXTENSION hstore SCHEMA public;
    CREATE FUNCTION public.managed_read() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    ALTER FUNCTION public.managed_read() OWNER TO managed;
    ${migration}
    ${migration}
    SELECT bool_and(NOT has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      FROM unnest(ARRAY['anon', 'authenticated']) r CROSS JOIN unnest(ARRAY['public.users', 'public._prisma_migrations', 'public.daily_closings']) t;
    SELECT NOT has_column_privilege('anon', 'public.users', 'name', 'SELECT,INSERT,UPDATE,REFERENCES');
    SELECT NOT has_sequence_privilege('anon', 'public.users_id_seq', 'USAGE,SELECT,UPDATE');
    SELECT NOT has_function_privilege('anon', 'public.app_read()', 'EXECUTE');
    SELECT has_function_privilege('anon', 'public.managed_read()', 'EXECUTE') AND has_function_privilege('anon', 'public.hstore_in(cstring)', 'EXECUTE');
    SELECT has_table_privilege('anon', 'auth.users', 'SELECT') AND has_table_privilege('anon', 'public.unrelated', 'SELECT');
    SET ROLE anon;
    DO $probe$ BEGIN
      BEGIN PERFORM name FROM public.users; RAISE EXCEPTION 'API read unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN UPDATE public.users SET name = 'anonymous overwrite'; RAISE EXCEPTION 'API update unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN TRUNCATE public.daily_closings; RAISE EXCEPTION 'API truncate unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM id FROM public._prisma_migrations; RAISE EXCEPTION 'API migration read unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM nextval('public.users_id_seq'); RAISE EXCEPTION 'API sequence unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.app_read(); RAISE EXCEPTION 'API routine unexpectedly allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $probe$;
    RESET ROLE;
    SET ROLE postgres;
    UPDATE public.users SET name = 'still writable';
    SELECT name FROM public.users;
    CREATE TABLE public.future_app (id serial);
    CREATE FUNCTION public.future_app_read() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    RESET ROLE;
    SELECT NOT has_table_privilege('anon', 'public.future_app', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    SELECT NOT has_sequence_privilege('authenticated', 'public.future_app_id_seq', 'USAGE,SELECT,UPDATE');
    SELECT NOT has_function_privilege('anon', 'public.future_app_read()', 'EXECUTE');
    ROLLBACK;`);
  assert.equal(result, ["t", "t", "t", "t", "t", "t", "still writable", "t", "t", "t"].join("\n"));
});

pgTest("hardening hook reapplies restrictions after a copied database recreates grants", () => {
  sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE public.users (id integer); GRANT ALL ON public.users TO anon, authenticated;");
  try {
    const harden = spawnSync(process.execPath, [join(root, "scripts/harden-supabase-api.mjs")], {
      cwd: root, encoding: "utf8", timeout: 30_000, env: { ...env, DATABASE_URL: `postgresql://backend@localhost/postgres?host=${encodeURIComponent(env.PGHOST)}&schema=public&connection_limit=1`, PATH: `${pgBin}:${process.env.PATH}` },
    });
    assert.equal(harden.status, 0, harden.stderr);
    assert.equal(sql("SELECT NOT has_table_privilege('anon', 'public.users', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass"), "t");
  } finally {
    sql("DROP TABLE public.users; DROP OWNED BY anon, authenticated; DROP ROLE anon; DROP ROLE authenticated;");
  }
});

test("hardening hook rejects invalid connection targets without echoing the supplied secret", () => {
  const secret = "synthetic-not-a-real-secret";
  const result = spawnSync(process.execPath, [join(root, "scripts/harden-supabase-api.mjs")], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: `https://user:${secret}@invalid.test/postgres` },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a PostgreSQL DATABASE_URL/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});
