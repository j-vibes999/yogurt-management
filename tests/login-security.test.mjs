import assert from "node:assert/strict";
import test from "node:test";
import { clientIp, LOCKOUT_THRESHOLD, lockoutUntil, oneAttemptAtATime, recordUnknownEmailFailure, resetUnknownEmailsForTests, unknownEmailLockedUntil } from "../src/lib/login-security.ts";

const MINUTE = 60 * 1000;

test("an account locks on the 5th failure for 15 minutes, doubling to at most 1 hour", () => {
  const now = Date.UTC(2026, 9, 26);
  assert.equal(LOCKOUT_THRESHOLD, 5);
  assert.equal(lockoutUntil(4, now), null);
  assert.equal(lockoutUntil(5, now).getTime() - now, 15 * MINUTE);
  assert.equal(lockoutUntil(6, now).getTime() - now, 30 * MINUTE);
  assert.equal(lockoutUntil(7, now).getTime() - now, 60 * MINUTE);
  assert.equal(lockoutUntil(50, now).getTime() - now, 60 * MINUTE);
  assert.equal(lockoutUntil(Number.NaN, now), null);
});

test("an unknown email locks exactly like a real account", () => {
  resetUnknownEmailsForTests();
  const now = Date.UTC(2026, 9, 26);
  for (let i = 1; i < 5; i++) assert.equal(recordUnknownEmailFailure(" Nobody@Example.test ", now), null);
  const locked = recordUnknownEmailFailure("nobody@example.test", now);
  assert.equal(locked.getTime() - now, 15 * MINUTE);
  assert.equal(unknownEmailLockedUntil("NOBODY@example.test", now + MINUTE)?.getTime(), locked.getTime());
  assert.equal(unknownEmailLockedUntil("nobody@example.test", now + 16 * MINUTE), null);
});

test("attempts for one email run one at a time", async () => {
  const order = [];
  const slow = (label, ms) => () => new Promise((resolve) => setTimeout(() => { order.push(label); resolve(label); }, ms));
  await Promise.all([oneAttemptAtATime("a@b.c", slow("first", 30)), oneAttemptAtATime("A@B.C", slow("second", 1))]);
  assert.deepEqual(order, ["first", "second"]);
});

test("only Cloudflare's client address header is trusted", () => {
  const headers = (values) => ({ get: (name) => values[name.toLowerCase()] ?? null });
  assert.equal(clientIp(headers({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" })), "203.0.113.7");
  assert.equal(clientIp(headers({ "x-forwarded-for": "1.1.1.1" })), "local");
  assert.equal(clientIp(headers({ "cf-connecting-ip": "not an ip" })), "local");
});
