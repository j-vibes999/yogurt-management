import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bootstrap = path.join(repository, "native/runtime/bootstrap.cjs");
const supervisorSource = path.join(repository, "native/runtime/supervisor.c");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(predicate, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await wait(25); }
  assert.fail("Timed out waiting for the owned runtime state");
}
async function temporary(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "yogurt-native-runtime-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function capture(child) {
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const exit = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exit, output: () => stdout, errors: () => stderr, events: () => stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)) };
}
async function compile(t) {
  assert.ok(existsSync(supervisorSource), "the native process supervisor must exist");
  const root = await temporary(t);
  const binary = path.join(root, "supervisor");
  const compiled = spawnSync("/usr/bin/cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-DYM_HEARTBEAT_MS=700", "-DYM_TERM_GRACE_MS=200", supervisorSource, "-o", binary], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  return { root, binary };
}
function supervise(t, binary, script) {
  const output = capture(spawn(binary, [process.execPath, script], { stdio: ["pipe", "pipe", "pipe"] }));
  t.after(() => { output.child.stdin.destroy(); if (output.child.exitCode === null) output.child.kill("SIGTERM"); });
  output.child.stdin.on("error", () => {});
  return output;
}

test("supervisor suppresses raw diagnostics and cleans an unresponsive owned process group on stdin EOF", async t => {
  const { root, binary } = await compile(t);
  const ids = path.join(root, "ids.json");
  const script = path.join(root, "hung.cjs");
  await writeFile(script, `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'}); process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ids)},JSON.stringify([process.pid,child.pid])); console.log('postgresql://private:password@host/db'); console.error('private-password'); console.log(JSON.stringify({version:1,type:'ready'})); while(true){}`);
  const runtime = supervise(t, binary, script);
  runtime.child.stdin.write('{"version":1,"type":"heartbeat"}\n');
  await until(() => runtime.output().includes('"ready"'));
  const pids = JSON.parse(await readFile(ids, "utf8"));
  runtime.child.stdin.end();
  await runtime.exit;
  await until(() => pids.every(pid => !alive(pid)));
  assert.deepEqual(runtime.events().map(event => event.type), ["ready", "shutdown"]);
  assert.equal(runtime.errors(), "");
  assert.doesNotMatch(runtime.output(), /private|password|postgresql/);
});

test("supervisor SIGTERM cleans a hung child instead of exiting and orphaning it", async t => {
  const { root, binary } = await compile(t);
  const script = path.join(root, "hung.cjs");
  const idFile = path.join(root, "pid");
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(idFile)},String(process.pid));process.on('SIGTERM',()=>{});console.log('{"version":1,"type":"ready"}');while(true){}`);
  const runtime = supervise(t, binary, script);
  await until(() => runtime.output().includes('"ready"'));
  const pid = Number(await readFile(idFile, "utf8"));
  runtime.child.kill("SIGTERM");
  await runtime.exit;
  assert.equal(alive(pid), false);
});

test("supervisor heartbeat deadline independently kills a blocked JavaScript event loop", async t => {
  const { root, binary } = await compile(t);
  const script = path.join(root, "hung.cjs");
  await writeFile(script, "process.on('SIGTERM',()=>{});console.log('{\"version\":1,\"type\":\"ready\"}');while(true){}");
  const runtime = supervise(t, binary, script);
  await runtime.exit;
  assert.ok(runtime.events().some(event => event.type === "failed" && event.code === "HEARTBEAT_TIMEOUT"));
});

test("supervisor survives parent death long enough to kill its entire owned backend group", async t => {
  const { root, binary } = await compile(t);
  const hung = path.join(root, "hung.cjs");
  const idFile = path.join(root, "pid");
  await writeFile(hung, `require('node:fs').writeFileSync(${JSON.stringify(idFile)},String(process.pid));process.on('SIGTERM',()=>{});console.log('{"version":1,"type":"ready"}');while(true){}`);
  const parent = path.join(root, "parent.cjs");
  await writeFile(parent, `const {spawn}=require('node:child_process');spawn(${JSON.stringify(binary)},[process.execPath,${JSON.stringify(hung)}],{stdio:['inherit','ignore','ignore']});setInterval(()=>{},1000);`);
  const process_ = spawn(process.execPath, [parent], { stdio: ["pipe", "ignore", "ignore"] });
  t.after(() => { process_.stdin.destroy(); process_.kill("SIGKILL"); });
  process_.stdin.write('{"version":1,"type":"heartbeat"}\n');
  await until(() => existsSync(idFile));
  const pid = Number(await readFile(idFile, "utf8"));
  process_.kill("SIGKILL");
  await until(() => !alive(pid));
});

test("supervisor preserves the child's canonical startup failure before reaping it", async t => {
  const { root, binary } = await compile(t);
  const script = path.join(root, "failed.cjs");
  await writeFile(script, "console.log('{\"version\":1,\"type\":\"failed\",\"code\":\"PORT_BUSY\"}');process.exit(1)");
  const runtime = supervise(t, binary, script);
  await runtime.exit;
  assert.deepEqual(runtime.events().filter(event => event.type === "failed"), [{ version: 1, type: "failed", code: "PORT_BUSY" }]);
});

const configuration = (root, dataRoot = path.join(root, "private data")) => ({ version: 1, type: "bootstrap", port: 43188, appRoot: root, dataRoot, capability: "c".repeat(64), config: { DATABASE_URL: "postgresql://owner:synthetic@db.synthetic.supabase.co:5432/postgres?sslmode=require", SESSION_SECRET: "s".repeat(64) } });
async function wrapperFixture(t, backend) {
  assert.ok(existsSync(bootstrap), "the versioned native bootstrap wrapper must exist");
  const root = await temporary(t);
  await mkdir(path.join(root, "desktop"));
  await writeFile(path.join(root, "desktop/backend.cjs"), backend);
  const runtime = capture(spawn(process.execPath, [bootstrap], { env: { ...process.env, NODE_OPTIONS: "", NEXT_PUBLIC_PRIVATE_TEST: "must-be-cleared", DATABASE_URL: "must-be-cleared" }, stdio: ["pipe", "pipe", "pipe"] }));
  t.after(() => { runtime.child.stdin.destroy(); if (runtime.child.exitCode === null) runtime.child.kill("SIGKILL"); });
  runtime.child.stdin.on("error", () => {});
  return { ...runtime, root };
}

test("bootstrap accepts one private pipe configuration, scopes environment and emits only canonical events", async t => {
  const runtime = await wrapperFixture(t, "if(process.env.PORT!=='43188'||process.env.NEXT_PUBLIC_PRIVATE_TEST||process.env.INTERNAL_APP_ORIGIN!=='http://127.0.0.1:43188'||!process.env.YOGURT_DESKTOP_TOKEN)throw Error('configuration'); console.log(process.env.DATABASE_URL);console.error(process.env.SESSION_SECRET);process.send({type:'ready',secret:process.env.SESSION_SECRET});process.on('message',m=>{if(m.type==='shutdown')process.exit(0)});");
  runtime.child.stdin.write(`${JSON.stringify(configuration(runtime.root))}\n`);
  await until(() => runtime.output().includes('"ready"'));
  runtime.child.stdin.write('{"version":1,"type":"shutdown"}\n');
  await runtime.exit;
  assert.deepEqual(runtime.events(), [{ version: 1, type: "ready" }]);
  assert.equal(runtime.errors(), "");
});

test("bootstrap rejects invalid versions, ports, duplicate bootstrap and arbitrary environment keys without echoing input", async t => {
  for (const mutate of [frame => { frame.version = 2; }, frame => { frame.port = 43187; }, frame => { frame.config.NODE_OPTIONS = "--require /private"; }, frame => { frame.config.DATABASE_URL += "&host=remote"; }]) {
    const runtime = await wrapperFixture(t, "process.send({type:'ready'});");
    const frame = configuration(runtime.root); mutate(frame);
    runtime.child.stdin.end(`${JSON.stringify(frame)}\n`);
    await runtime.exit;
    assert.deepEqual(runtime.events(), [{ version: 1, type: "failed", code: "CONFIGURATION" }]);
    assert.doesNotMatch(runtime.output(), /synthetic|private|NODE_OPTIONS/);
  }
  const runtime = await wrapperFixture(t, "process.send({type:'ready'});");
  const frame = `${JSON.stringify(configuration(runtime.root))}\n`;
  runtime.child.stdin.write(frame + frame);
  await runtime.exit;
  assert.ok(runtime.events().some(event => event.code === "CONTROL_PROTOCOL"));
});

test("bootstrap reports a sanitized startup error when the configured backend throws", async t => {
  const runtime = await wrapperFixture(t, "throw Error('postgresql://private:password@host/db')");
  runtime.child.stdin.write(`${JSON.stringify(configuration(runtime.root))}\n`);
  await runtime.exit;
  assert.deepEqual(runtime.events(), [{ version: 1, type: "failed", code: "START_FAILED" }]);
});

test("suppressed backend stream writes still complete their callbacks without exposing diagnostic bytes", async t => {
  const runtime = await wrapperFixture(t, "process.stdout.write(process.env.DATABASE_URL,()=>process.stderr.write(process.env.SESSION_SECRET,()=>process.send({type:'ready'})));process.on('message',m=>{if(m.type==='shutdown')process.exit(0)});");
  runtime.child.stdin.write(`${JSON.stringify(configuration(runtime.root))}\n`);
  await until(() => runtime.output().includes('"ready"'));
  runtime.child.stdin.write('{"version":1,"type":"shutdown"}\n');
  await runtime.exit;
  assert.deepEqual(runtime.events(), [{ version: 1, type: "ready" }]);
  assert.equal(runtime.errors(), "");
});

test("bootstrap port collision fails without touching the unrelated loopback listener", async t => {
  const occupied = net.createServer(socket => socket.end("existing"));
  await new Promise((resolve, reject) => { occupied.once("error", reject); occupied.listen(43188, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const runtime = await wrapperFixture(t, "const {startLocalServer}=require('./local-server.cjs');startLocalServer({port:Number(process.env.PORT),token:process.env.YOGURT_DESKTOP_TOKEN,requestHandler(){}}).then(()=>process.send({type:'ready'})).catch(()=>{process.send({type:'failed',code:'PORT_BUSY'});process.exit(1)});");
  await cp(path.join(repository, "desktop/local-server.cjs"), path.join(runtime.root, "desktop/local-server.cjs"));
  runtime.child.stdin.write(`${JSON.stringify(configuration(runtime.root))}\n`);
  await runtime.exit;
  assert.deepEqual(runtime.events(), [{ version: 1, type: "failed", code: "PORT_BUSY" }]);
  assert.equal(occupied.listening, true);
});

test("native Node archive verification requires its official filename checksum and rejects changed bytes", async () => {
  const script = path.join(repository, "scripts/build-native-legacy.mjs");
  assert.ok(existsSync(script), "the native package builder must exist");
  const { verifyArchiveAgainstManifest } = await import(script);
  const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  assert.equal(verifyArchiveAgainstManifest(Buffer.alloc(0), `${emptyHash}  node-fixture.tar.gz\n`, "node-fixture.tar.gz"), emptyHash);
  assert.throws(() => verifyArchiveAgainstManifest(Buffer.from("changed"), `${emptyHash}  node-fixture.tar.gz\n`, "node-fixture.tar.gz"));
  assert.throws(() => verifyArchiveAgainstManifest(Buffer.alloc(0), `${emptyHash}  another.tar.gz\n`, "node-fixture.tar.gz"));
});

test("native signing prefers a stable certificate identity so Keychain access survives updates", async () => {
  const { chooseSigningIdentity } = await import(path.join(repository, "scripts/build-native.mjs"));
  const development = `  1) ${"A".repeat(40)} "Apple Development: owner@example.test (TEAM123456)"\n     1 valid identities found\n`;
  const distribution = `  2) ${"B".repeat(40)} "Developer ID Application: Owner (TEAM123456)"\n`;
  assert.equal(chooseSigningIdentity(development), "A".repeat(40));
  assert.equal(chooseSigningIdentity(development + distribution), "B".repeat(40));
  assert.equal(chooseSigningIdentity(`  1) ${"C".repeat(40)} "Apple Distribution: Owner (TEAM123456)"\n`), "-");
  assert.equal(chooseSigningIdentity("     0 valid identities found\n"), "-");
  assert.equal(chooseSigningIdentity(development, "-"), "-");
});
