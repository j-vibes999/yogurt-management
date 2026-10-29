import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startLocalServer } = require('../desktop/local-server.cjs');
const token = randomBytes(48).toString('base64url');

function request(port, { headers = {}, pathname = '/', method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('desktop listener blocks missing capability on every path before privileged handler', async () => {
  let handled = 0;
  const local = await startLocalServer({ port: 0, token, requestHandler: (_req, res) => { handled++; res.end('private'); } });
  try {
    for (const pathname of ['/', '/api/auth/login', '/_next/static/test.js', '/api/health', '/_desktop/ready']) {
      const denied = await request(local.port, { pathname });
      assert.equal(denied.status, 403);
      assert.doesNotMatch(denied.body, new RegExp(token));
    }
    assert.equal(handled, 0);
    assert.equal((await request(local.port, { headers: { 'x-yogurt-desktop-token': token } })).body, 'private');
    assert.equal(handled, 1);
    const ready = await request(local.port, { pathname: '/_desktop/ready', headers: { 'x-yogurt-desktop-token': token } });
    assert.equal(ready.status, 200);
    assert.deepEqual(JSON.parse(ready.body), { ready: true });
  } finally { await local.stop(); }
});

test('valid capability cannot bypass desktop Host, Origin or cross-site checks', async () => {
  let seenHeaders;
  const local = await startLocalServer({ port: 0, token, requestHandler: (req, res) => { seenHeaders = req.headers; res.end('ok'); } });
  try {
    for (const headers of [
      { 'x-yogurt-desktop-token': 'wrong' },
      { 'x-yogurt-desktop-token': token, host: 'attacker.test' },
      { 'x-yogurt-desktop-token': token, origin: 'https://attacker.test' },
      { 'x-yogurt-desktop-token': token, 'sec-fetch-site': 'cross-site' },
    ]) assert.equal((await request(local.port, { headers, method: 'POST' })).status, 403);
    const response = await request(local.port, { headers: {
      'x-yogurt-desktop-token': token, origin: `http://127.0.0.1:${local.port}`,
      'x-forwarded-host': 'attacker.test', 'x-forwarded-proto': 'https', 'cf-connecting-ip': '1.2.3.4',
    } });
    assert.equal(response.status, 200);
    assert.equal(seenHeaders['x-forwarded-host'], undefined);
    assert.equal(seenHeaders['x-forwarded-proto'], undefined);
    assert.equal(seenHeaders['cf-connecting-ip'], undefined);
  } finally { await local.stop(); }
});

test('port collision fails without switching origin or stopping existing listener; stop frees owned port', async () => {
  const first = await startLocalServer({ port: 0, token, requestHandler: (_req, res) => res.end('first') });
  const occupied = first.port;
  try {
    await assert.rejects(startLocalServer({ port: occupied, token, requestHandler: (_req, res) => res.end('second') }), { code: 'EADDRINUSE' });
    assert.equal((await request(occupied, { headers: { 'x-yogurt-desktop-token': token } })).body, 'first');
  } finally { await first.stop(); }
  await assert.rejects(request(occupied), error => ['ECONNREFUSED', 'ECONNRESET'].includes(error.code));
});

test('handler failures expose no exception/secret content and weak capabilities are refused', async () => {
  await assert.rejects(startLocalServer({ port: 0, token: 'weak', requestHandler() {} }), /capability/i);
  const local = await startLocalServer({ port: 0, token, requestHandler() { throw new Error(`postgres://secret ${token}`); } });
  try {
    const response = await request(local.port, { headers: { 'x-yogurt-desktop-token': token } });
    assert.equal(response.status, 500);
    assert.doesNotMatch(response.body, /postgres|secret/);
    assert.doesNotMatch(response.body, new RegExp(token));
  } finally { await local.stop(); }
});
