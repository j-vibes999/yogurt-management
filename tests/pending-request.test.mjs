import test from "node:test";
import assert from "node:assert/strict";
import { createPendingStorage, financialStorageKeys, legacyFinancialRequests, parsePendingRequest } from "../src/lib/pending-request.ts";

const key = "8f523c60-e1e0-4e26-9d6d-395fbfc2ff5d";
const body = JSON.stringify({ storeId: "store-01", paidAmount: 5000, paymentMethod: "cash" });

test("an unresolved financial request survives page reload with its original key and amount", () => {
  assert.deepEqual(parsePendingRequest(JSON.stringify({ key, body }), "store-01"), { key, body, paidAmount: 5000 });
});

test("pending request from another store or corrupted browser storage is ignored", () => {
  assert.equal(parsePendingRequest(JSON.stringify({ key, body }), "store-02"), null);
  assert.equal(parsePendingRequest(JSON.stringify({ key: "bad", body }), "store-01"), null);
  assert.equal(parsePendingRequest("{broken", "store-01"), null);
});

test("canonical fractional pending payments preserve the exact body on reload", () => {
  const body = JSON.stringify({ storeId: "store-01", paidAmount: "14000.70", paymentMethod: "cash" });
  assert.deepEqual(parsePendingRequest(JSON.stringify({ key, body }), "store-01"), { key, body, paidAmount: 14000.7 });
  for (const paidAmount of ["0.004", "-1", "", true]) {
    assert.equal(parsePendingRequest(JSON.stringify({ key, body: JSON.stringify({ storeId: "store-01", paidAmount }) }), "store-01"), null);
  }
});

test("blocked browser storage keeps the original request available for retry in this page", () => {
  const storage = createPendingStorage(() => { throw new Error("Storage disabled"); });
  const keys = financialStorageKeys("user-a", "store-01");
  assert.equal(storage.read(keys.payment), null);
  assert.equal(storage.write(keys.payment, JSON.stringify({ key, body })), false);
  assert.deepEqual(parsePendingRequest(storage.read(keys.payment), "store-01"), { key, body, paidAmount: 5000 });
  storage.remove(keys.payment);
  assert.equal(storage.read(keys.payment), null);
});

test("a failed overwrite keeps the latest draft rather than restoring a stale persisted value", () => {
  const persisted = new Map();
  let full = false;
  const storage = createPendingStorage(() => ({
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => { if (full) throw new Error("Quota exceeded"); persisted.set(key, value); },
    removeItem: (key) => persisted.delete(key),
  }));
  assert.equal(storage.write("draft", "old"), true);
  full = true;
  assert.equal(storage.write("draft", "latest"), false);
  assert.equal(storage.read("draft"), "latest");
});

test("account and store namespaces prevent another account from restoring an unresolved payment", () => {
  const rows = new Map();
  const storage = createPendingStorage(() => ({
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: (key) => rows.delete(key),
  }));
  const owner = financialStorageKeys("user-a", "store-01");
  const otherUser = financialStorageKeys("user-b", "store-01");
  const otherStore = financialStorageKeys("user-a", "store-02");
  storage.write(owner.payment, JSON.stringify({ key, body }));
  assert.equal(storage.read(otherUser.payment), null);
  assert.equal(storage.read(otherStore.payment), null);
  assert.equal(parsePendingRequest(storage.read(owner.payment), "store-01").key, key);
  assert.notEqual(financialStorageKeys("a:b", "c").payment, financialStorageKeys("a", "b:c").payment);
});

test("legacy requests retain their original receipt identity for review without account reassignment", () => {
  const rows = new Map();
  const storage = createPendingStorage(() => ({
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: (key) => rows.delete(key),
  }));
  const legacyKey = "yogurt-payment-pending:store-01";
  storage.write(legacyKey, JSON.stringify({ key, body }));
  const [request] = legacyFinancialRequests("store-01", storage);
  assert.equal(request.key, key);
  assert.equal(request.receiptNumber, "PM-8F523C60E1E04E269D6D395FBFC2FF5D");
  assert.equal(request.storageKey, legacyKey);
  assert.equal(storage.read(financialStorageKeys("user-b", "store-01").payment), null);
  assert.equal(legacyFinancialRequests("store-02", storage).length, 0);
  storage.remove(legacyKey);
  assert.equal(legacyFinancialRequests("store-01", storage).length, 0);
});
