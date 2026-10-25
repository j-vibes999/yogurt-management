import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCredentialTag, signSession, SESSION_COOKIE } from "../src/lib/auth-session.ts";

const port = 3102;
const base = `http://127.0.0.1:${port}`;
const secret = process.env.SESSION_SECRET;
assert.ok(secret && secret.length >= 32, "SESSION_SECRET is required");
const credentialTag = await createCredentialTag("offline-test", "synthetic-offline-password-hash", secret);
const cookie = `${SESSION_COOKIE}=${await signSession({ userId: "offline-test", email: "offline@example.test", fullName: "Offline Test", role: "admin", credentialTag, exp: Math.floor(Date.now()/1000)+300 }, secret)}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
  env: { ...process.env, DATABASE_URL: "postgresql://offline@127.0.0.1:1/offline?schema=public", PORT: String(port), INTERNAL_APP_ORIGIN: base },
  stdio: "ignore",
});

try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.status === 503) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "offline server must start");
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).source, "offline");
  for (const page of ["/", "/stores", "/driver", "/reports", "/settlements"]) {
    const response = await fetch(`${base}${page}`, { headers: { cookie }, redirect: "manual" });
    assert.equal(response.status, 200, `${page} must render demo data while the database is down`);
  }
  const directPage = await fetch(`${base}/inventory`, { headers: { cookie }, redirect: "manual" });
  assert.equal(directPage.status, 307);
  assert.equal(new URL(directPage.headers.get("location"), base).pathname, "/");
  const write = await fetch(`${base}/api/settlements/pay`, { method: "POST", headers: { cookie, "content-type": "application/json", "Idempotency-Key":crypto.randomUUID() }, body: JSON.stringify({ storeId: "store-01", paidAmount: 1, paymentMethod: "cash" }) });
  assert.notEqual(write.status, 201, "offline demo cannot record a payment");
  console.log("Offline demo fallback E2E passed");
} finally {
  server.kill("SIGTERM");
}
