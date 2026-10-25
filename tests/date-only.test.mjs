import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateOnly, businessDateString, businessReportRange } from '../src/lib/date-only.ts';

test('calendar parser rejects rollover and accepts leap dates',()=>{
  assert.equal(parseDateOnly('2026-02-31'),null);
  assert.equal(parseDateOnly('2026-02-29'),null);
  assert.equal(parseDateOnly('2024-02-29').toISOString(),'2024-02-29T12:00:00.000Z');
});
test('business ranges include local midnight and exclude next midnight',()=>{
  const now=new Date('2026-09-30T18:30:00Z');
  assert.equal(businessDateString(now),'2026-10-01');
  assert.deepEqual(businessReportRange('month',now),{from:new Date('2026-09-30T17:00:00Z'),to:new Date('2026-10-31T17:00:00Z')});
  assert.deepEqual(businessReportRange('today',now),{from:new Date('2026-09-30T17:00:00Z'),to:new Date('2026-10-01T17:00:00Z')});
  assert.deepEqual(businessReportRange('7d',now),{from:new Date('2026-09-24T17:00:00Z'),to:new Date('2026-10-01T17:00:00Z')});
});
