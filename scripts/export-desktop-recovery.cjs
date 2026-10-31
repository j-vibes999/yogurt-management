#!/usr/bin/env node
'use strict';

// One-time migration helper using the existing development Electron dependency.
// It is not bundled with the Swift app. Originals are never opened by Chromium.
// Values stay opaque: hash-only operations and ownerless legacy requests cannot
// be mapped safely. Any exported records must keep the native write gate closed
// until the native recovery review explicitly accounts for them.
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

const ORIGIN = 'http://127.0.0.1:43187';
const PARTITION = 'yogurt-manager';
const PREFIXES = Object.freeze([
  'yogurt:operation:', 'yogurt:pending-operation:', 'yogurt-restock-draft:',
  'yogurt-payment-pending:', 'yogurt-restock-pending:',
]);
const uid = process.getuid?.();
const fail = code => { const error = new Error(code); error.code = code; throw error; };

function argumentsFor(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--profile', '--output'].includes(flag) || result[flag.slice(2)] !== undefined || !args[index + 1]) fail('INVALID_ARGUMENTS');
    result[flag.slice(2)] = args[index + 1];
  }
  if (!result.profile || !result.output || !path.isAbsolute(result.profile) || !path.isAbsolute(result.output)) fail('ABSOLUTE_PATHS_REQUIRED');
  return result;
}

async function noSymlinkComponents(input) {
  const resolved = path.resolve(input);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) fail('SYMLINK_PATH_REJECTED');
  }
  return resolved;
}

async function ownedDirectory(input) {
  const resolved = await noSymlinkComponents(input);
  const info = await fs.lstat(resolved);
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o022) !== 0) fail('OWNED_PRIVATE_DIRECTORY_REQUIRED');
  return resolved;
}

async function outputDestination(input, profile) {
  const parent = await ownedDirectory(path.dirname(input));
  const output = path.join(parent, path.basename(input));
  const relative = path.relative(profile, output);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('OUTPUT_INSIDE_PROFILE_REJECTED');
  try { await fs.lstat(output); fail('OUTPUT_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return output;
}

async function assertQuiescent(profile) {
  // Do not close or signal the old app, remove its locks, or certify a live copy.
  let processes;
  try { ({ stdout: processes } = await execute('/bin/ps', ['-axo', 'pid=,command='], { maxBuffer: 4 * 1024 * 1024 })); }
  catch { fail('CANNOT_CERTIFY_QUIESCENT_PROFILE'); }
  if (processes.split('\n').some(line => /\/Yogurt Manager\.app\/Contents\/MacOS\/Yogurt Manager(?:\s|$)/.test(line) || /(?:^|\s)(?:[^\s]*\/)?desktop\/main\.cjs(?:\s|$)/.test(line) || line.includes('--yogurt-profile=' + profile))) fail('OLD_APP_OR_PROFILE_IN_USE');
  try {
    const { stdout } = await execute('/usr/sbin/lsof', ['-nP', '-Fpc', '+D', profile], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
    if (/^p\d+$/m.test(stdout)) fail('OLD_APP_OR_PROFILE_IN_USE');
  } catch (error) {
    if (error.code === 'OLD_APP_OR_PROFILE_IN_USE') throw error;
    if (/^p\d+$/m.test(error.stdout ?? '')) fail('OLD_APP_OR_PROFILE_IN_USE');
    if (error.code !== 1 || error.stdout?.trim() || error.stderr?.trim()) fail('CANNOT_CERTIFY_QUIESCENT_PROFILE');
  }
}

async function inventory(directory, relative = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    const file = path.join(directory, entry.name);
    const info = await fs.lstat(file);
    if (info.isSymbolicLink() || info.uid !== uid || (!info.isDirectory() && !info.isFile())) fail('UNSAFE_PROFILE_ENTRY');
    if ((info.mode & 0o022) !== 0) fail('WRITABLE_PROFILE_ENTRY_REJECTED');
    result.push([name, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
    if (info.isDirectory()) result.push(...await inventory(file, name));
  }
  return result;
}

async function copyOwnedTree(source, target) {
  const info = await fs.lstat(source);
  if (info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o022) !== 0) fail('UNSAFE_PROFILE_ENTRY');
  if (info.isDirectory()) {
    await fs.mkdir(target, { mode: 0o700 });
    for (const name of await fs.readdir(source)) await copyOwnedTree(path.join(source, name), path.join(target, name));
  } else if (info.isFile()) {
    // O_NOFOLLOW also protects the final source component if it changes after lstat.
    const input = await fs.open(source, sync.constants.O_RDONLY | sync.constants.O_NOFOLLOW);
    let output;
    try {
      const current = await input.stat();
      if (!current.isFile() || current.uid !== uid || current.dev !== info.dev || current.ino !== info.ino) fail('PROFILE_CHANGED_DURING_COPY');
      output = await fs.open(target, 'wx', 0o600);
      const bytes = Buffer.alloc(64 * 1024);
      let position = 0;
      while (position < current.size) {
        const { bytesRead } = await input.read(bytes, 0, Math.min(bytes.length, current.size - position), position);
        if (bytesRead === 0) fail('PROFILE_CHANGED_DURING_COPY');
        let written = 0;
        while (written < bytesRead) {
          const { bytesWritten } = await output.write(bytes, written, bytesRead - written, position + written);
          if (bytesWritten === 0) fail('PROFILE_COPY_FAILED');
          written += bytesWritten;
        }
        position += bytesRead;
      }
    } finally { await output?.close(); await input.close(); }
  } else { fail('UNSAFE_PROFILE_ENTRY'); }
}

function readScript() {
  return `(() => {
    if (window.location.origin !== ${JSON.stringify(ORIGIN)}) throw new Error('WRONG_ORIGIN');
    const prefixes = ${JSON.stringify(PREFIXES)};
    const records = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key !== null && prefixes.some(prefix => key.startsWith(prefix))) {
        const value = localStorage.getItem(key);
        if (typeof value !== 'string') throw new Error('STORAGE_CHANGED');
        records.push({ key, value });
      }
    }
    return records.sort((a, b) => a.key.localeCompare(b.key));
  })()`;
}

function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 10000) fail('INVALID_EXPORT_RECORDS');
  const seen = new Set();
  for (const row of records) {
    if (!row || typeof row.key !== 'string' || typeof row.value !== 'string' || !PREFIXES.some(prefix => row.key.startsWith(prefix)) || seen.has(row.key)) fail('INVALID_EXPORT_RECORDS');
    seen.add(row.key);
  }
  if (Buffer.byteLength(JSON.stringify(records)) > 8 * 1024 * 1024) fail('EXPORT_TOO_LARGE');
  return records;
}

function launchWorker(clone, work, token) {
  return new Promise((resolve, reject) => {
    const executable = require('electron');
    if (typeof executable !== 'string' || !path.isAbsolute(executable)) return reject(new Error('INSTALLED_ELECTRON_REQUIRED'));
    const child = spawn(executable, [__filename, '--recovery-worker', '--profile', clone, '--output', path.join(work, 'records.json')], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore'], env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TMPDIR: os.tmpdir(), LANG: 'en_US.UTF-8',
        YOGURT_RECOVERY_TOKEN: token, YOGURT_RECOVERY_CONTEXT: path.join(work, 'context.json'),
      },
    });
    let timedOut = false;
    let killTimer;
    const timeout = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { } }, 2000);
    }, 45000);
    child.once('error', () => { clearTimeout(timeout); clearTimeout(killTimer); reject(new Error('WORKER_LAUNCH_FAILED')); });
    child.once('exit', code => {
      clearTimeout(timeout); clearTimeout(killTimer);
      if (code === 0 && !timedOut) resolve(); else reject(new Error(timedOut ? 'WORKER_TIMEOUT' : 'WORKER_FAILED'));
    });
  });
}

async function exportRecovery(options) {
  if (uid === undefined || uid === 0) fail('OWNED_USER_SESSION_REQUIRED');
  const profile = await ownedDirectory(options.profile);
  const output = await outputDestination(options.output, profile);
  const partition = await ownedDirectory(path.join(profile, 'Partitions', PARTITION));
  await assertQuiescent(profile);
  const before = JSON.stringify(await inventory(partition));
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const work = await fs.mkdtemp(path.join(temporaryRoot, 'yogurt-recovery-export-'));
  await fs.chmod(work, 0o700);
  try {
    const clone = path.join(work, 'profile');
    await fs.mkdir(path.join(clone, 'Partitions'), { recursive: true, mode: 0o700 });
    // Only Chromium's named session is needed. Do not copy runtime/configuration/receipts.
    await copyOwnedTree(partition, path.join(clone, 'Partitions', PARTITION));
    const token = randomBytes(32).toString('hex');
    await fs.writeFile(path.join(work, 'context.json'), JSON.stringify({ token, clone }), { flag: 'wx', mode: 0o600 });
    if (JSON.stringify(await inventory(partition)) !== before) fail('PROFILE_CHANGED_DURING_COPY');
    await assertQuiescent(profile);
    await launchWorker(clone, work, token);
    const raw = await fs.readFile(path.join(work, 'records.json'), 'utf8');
    const records = validateRecords(JSON.parse(raw));
    await assertQuiescent(profile);
    if (JSON.stringify(await inventory(partition)) !== before) fail('PROFILE_CHANGED_DURING_EXPORT');
    // The native reader accepts at most 8 MiB and a whole-second ISO8601 date.
    const serialized = JSON.stringify({ format: 'yogurt-legacy-recovery-v1', origin: ORIGIN, exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), records }, null, 2) + '\n';
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) fail('EXPORT_TOO_LARGE');
    const handle = await fs.open(output, sync.constants.O_CREAT | sync.constants.O_EXCL | sync.constants.O_WRONLY | sync.constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(serialized); await handle.sync(); }
    finally { await handle.close(); }
    return records.length;
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}

function runWorker() {
  const { app, BrowserWindow, session } = require('electron');
  // Synchronous checks are intentional: userData must change before Electron becomes ready.
  const options = argumentsFor(process.argv.slice(3));
  const contextPath = process.env.YOGURT_RECOVERY_CONTEXT;
  if (!contextPath || !process.env.YOGURT_RECOVERY_TOKEN) fail('INVALID_WORKER_CONTEXT');
  const work = path.dirname(contextPath);
  const canonicalTemporaryRoot = sync.realpathSync(os.tmpdir());
  if (path.dirname(work) !== canonicalTemporaryRoot || !path.basename(work).startsWith('yogurt-recovery-export-') || sync.realpathSync(work) !== work) fail('INVALID_WORKER_DIRECTORY');
  for (const file of [work, contextPath, options.profile]) {
    const info = sync.lstatSync(file);
    if (info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o077) !== 0) fail('INVALID_WORKER_OWNERSHIP');
  }
  const context = JSON.parse(sync.readFileSync(contextPath, 'utf8'));
  if (context.token !== process.env.YOGURT_RECOVERY_TOKEN || options.profile !== context.clone || options.profile !== path.join(work, 'profile') || options.output !== path.join(work, 'records.json')) fail('INVALID_WORKER_CONTEXT');
  app.setName('Yogurt Recovery Export');
  app.setPath('userData', options.profile);
  app.setPath('sessionData', options.profile);
  app.disableHardwareAcceleration();
  app.enableSandbox();
  for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'no-first-run', 'disable-breakpad']) app.commandLine.appendSwitch(flag);
  let window;
  app.whenReady().then(async () => {
    app.dock?.hide();
    const browser = session.fromPartition('persist:' + PARTITION, { cache: false });
    const blankURL = ORIGIN + '/__yogurt_recovery_export__/' + randomUUID();
    browser.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browser.setPermissionCheckHandler(() => false);
    browser.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: details.url !== blankURL || details.resourceType !== 'mainFrame' }));
    browser.on('will-download', event => event.preventDefault());
    const denied = () => new Response('', { status: 403 });
    browser.protocol.handle('http', request => request.url === blankURL && request.method === 'GET'
      ? new Response('<!doctype html><meta charset="utf-8"><title>Recovery export</title>', { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; connect-src 'none'; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
      } }) : denied());
    browser.protocol.handle('https', denied);
    // Remove executable cached workers on the COPY before visiting the trusted blank page.
    await browser.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    window = new BrowserWindow({ show: false, width: 300, height: 200, skipTaskbar: true,
      webPreferences: { session: browser, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false, spellcheck: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== blankURL) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    await window.loadURL(blankURL);
    const records = validateRecords(await window.webContents.executeJavaScript(readScript()));
    await fs.writeFile(options.output, JSON.stringify(records), { flag: 'wx', mode: 0o600 });
  }).then(() => { window?.destroy(); app.exit(0); }).catch(() => { window?.destroy(); app.exit(1); });
}

module.exports = { argumentsFor, noSymlinkComponents, ownedDirectory, outputDestination, validateRecords, exportRecovery, PREFIXES, ORIGIN };
// Electron 45 loads its CJS entry without setting require.main to that module.
if (process.versions.electron && process.argv[1] === __filename && process.argv[2] === '--recovery-worker') {
  try { runWorker(); } catch { require('electron').app.exit(1); }
} else if (require.main === module) {
  exportRecovery(argumentsFor(process.argv.slice(2))).then(count => {
    process.stdout.write(`Exported ${count} recovery record${count === 1 ? '' : 's'}.\n`);
  }).catch(error => {
    const code = /^[A-Z_]+$/.test(error.code ?? error.message ?? '') ? error.code ?? error.message : 'EXPORT_FAILED';
    process.stderr.write(`Recovery export refused (${code}). The old profile was not modified; a clear recovery state cannot be certified until the old app and profile are quiescent.\n`);
    process.exitCode = 1;
  });
}
