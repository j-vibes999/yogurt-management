import assert from "node:assert/strict";
import test from "node:test";
import { createCredentialTag, signSession, verifySession, verifySessionCredentials } from "../src/lib/auth-session.ts";

const secret = "test-secret-that-is-definitely-longer-than-thirty-two-chars";
const passwordHash = "synthetic-password-hash-before-reset";
const credentialTag = await createCredentialTag("u1", passwordHash, secret);
const base = { userId: "u1", sid: "s".repeat(43), email: "owner@example.test", fullName: "Owner", role: "admin", credentialTag };

test("signed session verifies", async () => {
  const token = await signSession({ ...base, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const session = await verifySession(token, secret);
  assert.equal(session?.userId, "u1");
  assert.equal(session?.role, "admin");
});

test("tampered session is rejected", async () => {
  const token = await signSession({ ...base, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const [body, sig] = token.split(".");
  const tampered = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${sig}`;
  assert.equal(await verifySession(tampered, secret), null);
});

test("expired session is rejected", async () => {
  const token = await signSession({ ...base, exp: Math.floor(Date.now() / 1000) - 1 }, secret);
  assert.equal(await verifySession(token, secret), null);
});

test("session credentials reject a changed password and a different user", async () => {
  const payload = { ...base, exp: Math.floor(Date.now() / 1000) + 60 };
  assert.equal(await verifySessionCredentials(payload, passwordHash, secret), true);
  assert.equal(await verifySessionCredentials(payload, "synthetic-password-hash-after-reset", secret), false);
  assert.equal(await verifySessionCredentials({ ...payload, userId: "u2" }, passwordHash, secret), false);
});

test("legacy sessions and malformed signed payloads are rejected", async () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const legacy = { ...base };
  delete legacy.credentialTag;
  for (const payload of [
    { ...legacy, exp },
    { ...base, exp: null },
    { ...base, exp: String(exp) },
    { ...base, exp, role: "owner" },
    { ...base, exp, credentialTag: "invalid" },
  ]) {
    assert.equal(await verifySession(await signSession(payload, secret), secret), null);
  }
  const token = await signSession({ ...base, exp }, secret);
  assert.equal(await verifySession(`${token}.extra`, secret), null);
});
