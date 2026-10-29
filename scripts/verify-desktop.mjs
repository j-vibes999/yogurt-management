import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { _electron } from 'playwright';
import { PrismaClient } from '@prisma/client';
import ts from 'typescript';

const repository = path.resolve(import.meta.dirname, '..');
const executable = process.env.DESKTOP_EXECUTABLE || path.join(repository, 'dist-desktop/mac-arm64/Yogurt Manager.app/Contents/MacOS/Yogurt Manager');
const pgBin = process.env.DESKTOP_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin';
const work = await realpath(await mkdtemp(path.join(tmpdir(), 'yogurt-desktop-e2e-')));
const profile = path.join(work, 'Application Profile With Spaces');
const cluster = path.join(work, 'postgres');
const testExecutable = path.join(work, 'Applications With Spaces/Yogurt Manager.app/Contents/MacOS/Yogurt Manager');
const verification = path.join(repository, 'docs/verification/desktop-2026-10-29');
const email = `e2e-${randomUUID()}@example.test`;
const password = randomBytes(32).toString('base64url');
const base = 'http://127.0.0.1:43187';
const checks = [];
const operationCode = ts.transpileModule(await readFile(path.join(repository, 'src/lib/operation-request.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let running;
let pgStarted = false;
let prisma;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWO4w8UFAAK2APG8J2s+AAAAAElFTkSuQmCC', 'base64');

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(command)} failed (${code}): ${output.slice(-1200)}`)));
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function portClosed() {
  for (let index = 0; index < 64; index++) {
    try { await fetch(`${base}/_desktop/ready`); }
    catch { return; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.fail('Desktop backend listener survived app exit');
}
async function launch(importSettings = false) {
  running = await _electron.launch({ executablePath: testExecutable, timeout: 90_000,
    args: [`--yogurt-profile=${profile}`, '--yogurt-test', ...(importSettings ? [`--import-settings=${path.join(work, '.yogurt/supabase.env')}`] : [])],
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG || 'en_US.UTF-8' },
  });
  const page = await running.firstWindow({ timeout: 90_000 });
  await page.waitForURL(url => url.origin === base, { timeout: 90_000 });
  await page.waitForLoadState('domcontentloaded');
  return page;
}
async function close() {
  if (!running) return;
  await running.close();
  running = undefined;
  await portClosed();
}
async function api(page, route, body, key) {
  return page.evaluate(async ({ route, body, key }) => {
    const response = await fetch(route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }, { route, body, key });
}
async function databaseSession(page) {
  let result;
  for (let attempt = 0; attempt < 40; attempt++) {
    result = await api(page, '/api/session');
    if (result.body.source === 'database') return result;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const health = await api(page, '/api/health');
  let direct = false;
  try { await prisma.$queryRaw`SELECT 1`; direct = true; } catch {}
  assert.fail(`Database session did not reconnect (${JSON.stringify({ status: result?.status, source: result?.body?.source, backendDatabase: health.body.db?.ok, directDatabase: direct })})`);
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }

async function expenseOperation(page, body, key, loseResponse = false) {
  return page.evaluate(async ({ code, body, key, loseResponse }) => {
    const exports = {};
    new Function('exports', code)(exports);
    const original = window.fetch;
    if (loseResponse) window.fetch = async (...args) => {
      const response = await original(...args);
      if (args[0] === '/api/expenses' && response.ok) throw new TypeError('Synthetic response lost after commit');
      return response;
    };
    try {
      const response = await exports.operationFetch('/api/expenses', body, { key });
      return { status: response.status, body: await response.json() };
    } catch {
      return { uncertain: true };
    } finally { window.fetch = original; }
  }, { code: operationCode, body, key, loseResponse });
}

try {
  try { await fetch(`${base}/_desktop/ready`); assert.fail('Desktop test port is already occupied'); }
  catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
  const port = await freePort();
  const databaseUrl = `postgresql://backend@127.0.0.1:${port}/yogurt_e2e_desktop?schema=public`;
  await run(path.join(pgBin, 'initdb'), ['-D', cluster, '-U', 'backend', '--auth=trust', '--no-locale']);
  await run(path.join(pgBin, 'pg_ctl'), ['-D', cluster, '-l', path.join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k '' -F`, '-w', 'start']);
  pgStarted = true;
  await run(path.join(pgBin, 'createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'backend', 'yogurt_e2e_desktop']);
  await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { DATABASE_URL: databaseUrl });
  await run(process.execPath, ['scripts/prepare-e2e-clone.mjs'], { DATABASE_URL: databaseUrl, ADMIN_EMAIL: email, ADMIN_PASSWORD: password, E2E_FIXTURE_MODE: 'minimal' });
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await mkdir(path.join(work, '.yogurt/private-receipts'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(work, '.yogurt/supabase.env'), `DATABASE_URL="${databaseUrl}"\n`, { mode: 0o600 });
  await writeFile(path.join(work, '.yogurt/private-receipts/receipt-imported-test.png'), png, { mode: 0o600 });
  await mkdir(verification, { recursive: true });
  await mkdir(path.dirname(path.dirname(path.dirname(testExecutable))), { recursive: true });
  await run('/usr/bin/ditto', [path.dirname(path.dirname(path.dirname(executable))), path.dirname(path.dirname(path.dirname(testExecutable)))]);

  let page = await launch(true);
  assert.equal(page.url(), `${base}/login?next=%2F`);
  await page.screenshot({ path: path.join(verification, 'login.png') });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`${base}/`, { timeout: 30_000 });
  // Electron's persistent partition differs from Playwright's default browser context.
  // Inspect only flags through the window's own session; never export cookie values.
  const cookies = await running.evaluate(async ({ BrowserWindow }) => {
    const rows = await BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({});
    return rows.map(({ httpOnly, secure, sameSite }) => ({ httpOnly, secure, sameSite }));
  });
  assert.ok(cookies.some(cookie => cookie.httpOnly && cookie.secure && cookie.sameSite === 'strict'), JSON.stringify(cookies));
  const session = await api(page, '/api/session');
  assert.equal(session.body.source, 'database');
  passed('packaged production login, Secure HttpOnly session cookie, native Prisma database connection');
  assert.deepEqual(await readFile(path.join(profile, 'runtime/private-receipts/receipt-imported-test.png')), png);
  assert.deepEqual(await readFile(path.join(work, '.yogurt/private-receipts/receipt-imported-test.png')), png);
  passed('private receipt import from .yogurt/supabase.env preserves source and verifies destination');
  assert.equal((await fetch(`${base}/api/session`)).status, 403);
  assert.equal((await fetch(`${base}/_next/static/anything.js`)).status, 403);
  passed('ordinary browsers cannot reach backend, login/session or static assets');
  await run(testExecutable, [`--yogurt-profile=${profile}`, '--yogurt-test']);
  assert.equal((await databaseSession(page)).body.source, 'database');
  passed('a duplicate application launch exits without a duplicate backend or losing the current session');
  await page.screenshot({ path: path.join(verification, 'dashboard.png') });

  const key = randomUUID();
  const body = { category: 'other', amount: '100.25', incurredAt: '2026-10-29', note: 'Synthetic desktop recovery test' };
  assert.equal((await expenseOperation(page, body, key, true)).uncertain, true);
  const expenseId = (await prisma.expense.findFirstOrThrow({ where: { note: body.note } })).id;
  await page.goto(`${base}/operations`);
  await page.screenshot({ path: path.join(verification, 'operations.png') });
  const closed = running.waitForEvent('close');
  await running.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed; running = undefined; await portClosed();
  passed('closing the last window quits the app and stops the owned loopback backend');
  page = await launch();
  assert.equal((await databaseSession(page)).body.source, 'database');
  const recovered = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('yogurt:pending-operation:'));
    return JSON.parse(localStorage.getItem(key));
  });
  assert.equal(recovered.key, key);
  assert.deepEqual(JSON.parse(recovered.body), body);
  const replayed = await expenseOperation(page, JSON.parse(recovered.body), recovered.key);
  assert.equal(replayed.status, 201);
  assert.equal(replayed.body.id, expenseId);
  assert.equal(await prisma.expense.count({ where: { id: expenseId } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { entityType: 'expense', entityId: expenseId, action: 'create' } }), 1);
  passed('stable browser storage/session survives restart; replay preserves a single financial entry/audit');
  const upload = await page.evaluate(async bytes => {
    const form = new FormData(); form.set('file', new File([new Uint8Array(bytes)], 'receipt.png', { type: 'image/png' }));
    const response = await fetch('/api/uploads/receipts', { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  }, [...png]);
  assert.equal(upload.status, 201);
  const receiptUrl = upload.body.url;
  await close(); page = await launch();
  const received = await page.evaluate(async route => {
    const response = await fetch(route); return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, receiptUrl);
  assert.equal(received.status, 200); assert.deepEqual(Buffer.from(received.bytes), png);
  passed('private receipt upload/read persists across application restart');
  const exported = path.join(work, 'desktop-export.csv');
  const download = running.evaluate(({ BrowserWindow }, filename) => new Promise(resolve => {
    BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
      item.setSavePath(filename);
      item.once('done', (_event, state) => resolve(state));
    });
  }), exported);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['name,amount\nSynthetic,100.25\n'], { type: 'text/csv' }));
    link.download = 'desktop-export.csv'; link.click();
  });
  assert.equal(await download, 'completed');
  assert.match(await readFile(exported, 'utf8'), /Synthetic,100\.25/);
  passed('native file export accepts an app-origin CSV download without leaving the workspace');
  const previousUrl = page.url();
  const previewOpened = running.waitForEvent('window', { timeout: 5000 });
  await page.evaluate(route => window.open(route, '_blank'), receiptUrl);
  const preview = await previewOpened;
  await preview.waitForURL(`${base}/api/receipts/**`);
  assert.equal(page.url(), previousUrl);
  await preview.close();
  assert.equal((await api(page, '/api/session')).body.source, 'database');
  passed('receipt preview preserves the main application and closing it keeps the session active');

  await run(path.join(pgBin, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop']); pgStarted = false;
  assert.equal((await api(page, '/api/session')).body.source, 'offline');
  assert.notEqual((await api(page, '/api/expenses', body, randomUUID())).status, 201);
  await run(path.join(pgBin, 'pg_ctl'), ['-D', cluster, '-l', path.join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k '' -F`, '-w', 'start']); pgStarted = true;
  assert.equal((await databaseSession(page)).body.source, 'database');
  passed('database disconnection never claims a successful write; reconnect restores database session');
  const pid = running.process().pid;
  process.kill(pid, 'SIGKILL');
  await running.waitForEvent('close', { timeout: 20_000 }).catch(() => {}); running = undefined;
  await portClosed();
  passed('force-killed app leaves no surviving owned backend listener');
  const report = { date: new Date().toISOString(), executable: path.relative(repository, executable), target: 'darwin-arm64', productionDatabaseMutated: false, checks, signing: 'Local-use unsigned/ad-hoc; not notarized' };
  await writeFile(path.join(verification, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Desktop acceptance passed (${checks.length} checks).`);
} finally {
  await close().catch(() => {});
  await prisma?.$disconnect();
  if (pgStarted) await run(path.join(pgBin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop']).catch(() => {});
  await rm(work, { recursive: true, force: true });
}
