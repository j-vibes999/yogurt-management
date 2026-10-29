import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadRecovery } from '../src/lib/database-recovery.ts';

test('a stale desktop pool is reset before retrying an authorization read once', async () => {
  let reset = false;
  let attempts = 0;
  const read = createReadRecovery(async () => { reset = true; });
  assert.equal(await read(async () => {
    attempts++;
    if (!reset) throw Object.assign(new Error('closed connection'), { code: 'P1017' });
    return 'active-session';
  }), 'active-session');
  assert.equal(attempts, 2);
});

test('concurrent stale session reads share one pool reset', async () => {
  let resets = 0;
  let healthy = false;
  const read = createReadRecovery(async () => { resets++; await new Promise(resolve => setImmediate(resolve)); healthy = true; });
  const session = async () => {
    if (!healthy) throw Object.assign(new Error('unreachable'), { code: 'P1001' });
    return 'session';
  };
  assert.deepEqual(await Promise.all([read(session), read(session), read(session)]), ['session', 'session', 'session']);
  assert.equal(resets, 1);
});

test('permanent downtime retries no more than once and schema/authorization errors are untouched', async () => {
  let resets = 0;
  let attempts = 0;
  const read = createReadRecovery(async () => { resets++; });
  await assert.rejects(read(async () => { attempts++; throw Object.assign(new Error('offline'), { code: 'P1001' }); }));
  assert.equal(attempts, 2); assert.equal(resets, 1);
  const other = Object.assign(new Error('invalid operation'), { code: 'P2002' });
  await assert.rejects(read(async () => { throw other; }), error => error === other);
  assert.equal(resets, 1);
});

test('a failed reconnect does not repeat the read or replay any callback', async () => {
  let attempts = 0;
  const read = createReadRecovery(async () => { throw new Error('still offline'); });
  await assert.rejects(read(async () => { attempts++; throw Object.assign(new Error('closed'), { code: 'P1017' }); }), /still offline/);
  assert.equal(attempts, 1);
});
