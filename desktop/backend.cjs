const path = require('node:path');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const { startLocalServer } = require('./local-server.cjs');

let local;
let nextApp;
let stopping = false;
let heartbeat = Date.now();
const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send?.(message);

async function stop() {
  if (stopping) return;
  stopping = true;
  const limit = setTimeout(() => process.exit(0), 4500);
  limit.unref();
  await local?.stop();
  await nextApp?.close();
  process.exit(0);
}

function message(data) {
  if (data?.type === 'heartbeat') heartbeat = Date.now();
  if (data?.type === 'shutdown') void stop();
}
process.parentPort?.on('message', event => message(event.data));
process.on('message', message);
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

const parent = Number(process.env.YOGURT_PARENT_PID);
const watchdog = setInterval(() => {
  let alive = Number.isSafeInteger(parent) && parent > 1;
  try { if (alive) process.kill(parent, 0); } catch { alive = false; }
  if (!alive || Date.now() - heartbeat > 12_000) void stop();
}, 2000);
watchdog.unref();

async function start() {
  const root = process.env.YOGURT_APP_ROOT;
  const data = process.env.YOGURT_DATA_ROOT;
  if (!root || !path.isAbsolute(root) || !data || !path.isAbsolute(data)) throw new Error('CONFIGURATION');
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  const port = Number(process.env.PORT || 43187);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('CONFIGURATION');
  const requireBackend = createRequire(path.join(root, 'package.json'));
  const config = JSON.parse(await fs.readFile(path.join(root, '.next', 'required-server-files.json'), 'utf8')).config;
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  const next = requireBackend('next');
  nextApp = next({ dev: false, dir: root, conf: config, hostname: '127.0.0.1', port });
  let handler;
  local = await startLocalServer({ port, token: process.env.YOGURT_DESKTOP_TOKEN,
    requestHandler: (request, response) => handler(request, response) });
  await nextApp.prepare();
  handler = nextApp.getRequestHandler();
  send({ type: 'ready' });
}

start().catch(error => {
  send({ type: 'failed', code: error?.code === 'EADDRINUSE' ? 'PORT_BUSY' : 'START_FAILED' });
  void stop();
});
