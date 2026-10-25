import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, passwordMeetsLength, verifyPassword } from "../src/lib/password.ts";

test("new passwords require at least 15 Unicode characters", async () => {
  assert.equal(passwordMeetsLength("a".repeat(14)), false);
  assert.equal(passwordMeetsLength("a".repeat(15)), true);
  assert.equal(passwordMeetsLength("😀".repeat(8)), false);
  await assert.rejects(hashPassword("a".repeat(14)), /at least 15/);
  const encoded = await hashPassword("a longer test passphrase");
  assert.equal(await verifyPassword("a longer test passphrase", encoded), true);
  assert.equal(await verifyPassword("another test passphrase", encoded), false);
});
