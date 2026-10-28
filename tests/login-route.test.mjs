import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { z } from "zod";
import * as limiter from "../src/lib/login-rate-limit.ts";
import * as security from "../src/lib/login-security.ts";
import { emailSchema } from "../src/lib/user-input.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = ts.transpileModule(readFileSync(new URL("../src/app/api/auth/login/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(known = false) {
  limiter.resetLoginRateLimitForTests();
  security.resetUnknownEmailsForTests();
  const work = { passwordVerifications: 0 };
  const user = known ? { id: "user-1", email: "owner@example.test", passwordHash: "scrypt$test-fixture", role: "admin", fullName: "Owner", isActive: true, failedLoginCount: 0, lockedUntil: null } : null;
  const imports = {
    "node:crypto": { randomUUID }, zod: { z },
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers ?? {}, cookies: { set() {} } }) } },
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => user, update: async ({ data }) => {
        if (data.failedLoginCount?.increment) user.failedLoginCount += data.failedLoginCount.increment;
        else if (data.failedLoginCount !== undefined) user.failedLoginCount = data.failedLoginCount;
        if (data.lockedUntil !== undefined) user.lockedUntil = data.lockedUntil;
        return user;
      } },
      userSession: { deleteMany: async () => ({}), create: async ({ data }) => data },
      $transaction: async operations => Promise.all(operations),
    } },
    "@/lib/audit": { writeAuditLog: async () => {} },
    "@/lib/auth-session": { getSessionSecret: () => "synthetic-test-session-secret", createSessionId: () => "test-session", SESSION_COOKIE: "session", createCredentialTag: async () => "tag", signSession: async () => "token" },
    "@/lib/password": { hashPassword: async () => "scrypt$decoy", verifyPassword: async password => { work.passwordVerifications += 1; return password === "correct-test-password"; } },
    "@/lib/login-rate-limit": limiter,
    "@/lib/login-security": security,
    "@/lib/logger": { logInfo() {}, logWarn() {} },
    "@/lib/user-input": { emailSchema },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, module: { exports }, Date, console, process: { env: { NODE_ENV: "test" } }, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { POST: exports.POST, user, work };
}

const request = (email = "owner@example.test", password = "incorrect-test-password", ip = "203.0.113.19") => new Request("https://login.test/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ email, password }),
});

test("concurrent rotating emails reserve the shared IP budget before async login work", async () => {
  const { POST, work } = fixture();
  let bodiesRead = 0;
  const responses = await Promise.all(Array.from({ length: 25 }, (_, i) => {
    const req = request(`rotating-${i}@example.test`);
    const read = req.json.bind(req);
    req.json = () => { bodiesRead += 1; return read(); };
    return POST(req);
  }));
  assert.equal(responses.filter(response => response.status === 401).length, 10);
  assert.equal(responses.filter(response => response.status === 429).length, 15);
  assert.equal(bodiesRead, 10);
  assert.equal(work.passwordVerifications, 10);
  assert.ok(Number(responses.find(response => response.status === 429).headers["Retry-After"]) > 0);
});

test("failed and malformed logins spend one IP attempt each without a second failure penalty", async () => {
  const { POST } = fixture();
  for (let i = 0; i < 10; i++) {
    const response = await POST(i % 2 ? request(`missing-${i}@example.test`) : request("bad-email"));
    assert.equal(response.status, i % 2 ? 401 : 400);
  }
  assert.equal((await POST(request())).status, 429);
});

test("real account lockout still starts on its fifth failure and denies a correct password while locked", async () => {
  const { POST, user } = fixture(true);
  for (let i = 0; i < 5; i++) assert.equal((await POST(request())).status, 401);
  assert.equal(user.failedLoginCount, 5);
  assert.ok(user.lockedUntil > new Date());
  assert.equal((await POST(request(user.email, "correct-test-password", "203.0.113.20"))).status, 429);
  assert.equal(user.failedLoginCount, 5);
});

test("successful login clears account failures while keeping the IP attempt budget", async () => {
  const { POST, user } = fixture(true);
  user.failedLoginCount = 4;
  user.lockedUntil = new Date(Date.now() - 1000);
  for (let i = 0; i < 10; i++) assert.equal((await POST(request(user.email, "correct-test-password"))).status, 200);
  assert.equal(user.failedLoginCount, 0);
  assert.equal(user.lockedUntil, null);
  assert.equal((await POST(request(user.email, "correct-test-password"))).status, 429);
});
