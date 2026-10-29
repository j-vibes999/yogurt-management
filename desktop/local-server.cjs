const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

const CAPABILITY_HEADER = 'x-yogurt-desktop-token';

async function startLocalServer({ port = 43187, token, requestHandler }) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{48,}$/.test(token)) throw new Error('Invalid desktop capability');
  const expected = Buffer.from(token);
  let activePort = port;
  const server = http.createServer((request, response) => {
    const given = request.headers[CAPABILITY_HEADER];
    const supplied = typeof given === 'string' ? Buffer.from(given) : Buffer.alloc(0);
    const origin = `http://127.0.0.1:${activePort}`;
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
      || request.headers.host !== `127.0.0.1:${activePort}`
      || (request.headers.origin && request.headers.origin !== origin)
      || request.headers['sec-fetch-site'] === 'cross-site') {
      response.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Desktop access required');
      return;
    }
    for (const name of Object.keys(request.headers)) {
      if (name.startsWith('x-forwarded-') || name.startsWith('cf-')) delete request.headers[name];
    }
    if (request.url === '/_desktop/ready' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ready: true }));
      return;
    }
    Promise.resolve().then(() => requestHandler(request, response)).catch(() => {
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(500, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Application request failed');
    });
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      activePort = server.address().port;
      resolve();
    });
  });
  let stopped;
  return {
    port: activePort,
    stop() {
      stopped ??= new Promise(resolve => {
        const timeout = setTimeout(() => server.closeAllConnections(), 3000);
        timeout.unref();
        server.close(() => { clearTimeout(timeout); resolve(); });
        server.closeIdleConnections();
      });
      return stopped;
    },
  };
}

module.exports = { CAPABILITY_HEADER, startLocalServer };
