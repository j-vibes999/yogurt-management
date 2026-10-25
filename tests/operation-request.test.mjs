import assert from "node:assert/strict";
import test from "node:test";

let moduleVersion = 0;
async function environment(run, { disabledStorage = false } = {}) {
  const stored = new Map();
  const writes = [];
  const requests = [];
  const events = new EventTarget();
  let invalidations = 0;
  events.addEventListener("yogurt:shell-invalidate", () => invalidations++);
  const localStorage = {
    getItem(key) { if (disabledStorage) throw new Error("Storage disabled"); return stored.get(key) ?? null; },
    setItem(key, value) { if (disabledStorage) throw new Error("Storage disabled"); writes.push([key, value]); stored.set(key, value); },
    removeItem(key) { if (disabledStorage) throw new Error("Storage disabled"); stored.delete(key); },
  };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, dispatchEvent: events.dispatchEvent.bind(events) } });
  let nextResponse = () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  let userId = "user-a";
  globalThis.fetch = (url, options) => {
    if (url === "/api/session") return Promise.resolve(new Response(JSON.stringify({ userId, source: "database" }), { status: 200 }));
    requests.push({ url, method: options.method, body: options.body, key: options.headers["Idempotency-Key"] });
    return nextResponse();
  };
  try {
    const { operationFetch } = await import(`../src/lib/operation-request.ts?test=${moduleVersion++}`);
    await run({ operationFetch, stored, writes, requests, setResponse(fn) { nextResponse = fn; }, setUser(id) { userId = id; }, invalidations: () => invalidations });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete globalThis.window;
  }
}

function deferredResponse() {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
async function waitForRequests(requests, count) {
  // Hashing the body runs off the main thread, so wait on the clock rather than a fixed number of turns.
  const deadline = Date.now() + 2000;
  while (requests.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(requests.length, count, `expected ${count} outgoing mutation requests`);
}

test("a late rejected response cannot erase a different uncertain body", async () => {
  await environment(async ({ operationFetch, setResponse, requests, stored }) => {
    const replies = [];
    setResponse(() => { const reply = deferredResponse(); replies.push(reply); return reply.promise; });
    const first = operationFetch("/api/expenses", { amount: "1.00" });
    await waitForRequests(requests, 1);
    const second = operationFetch("/api/expenses", { amount: "2.00" });
    await waitForRequests(requests, 2);
    replies[1].resolve(Response.json({ retryable: false }, { status: 400 }));
    await waitForRequests(requests, 3);
    const secondKey = requests[2].key;
    replies[0].resolve(Response.json({ retryable: false }, { status: 400 }));
    await first;
    const pending = JSON.parse([...stored].find(([key]) => key.startsWith("yogurt:pending-operation:"))[1]);
    assert.equal(pending.key, secondKey);
    assert.equal(JSON.parse(pending.body).amount, "2.00");
    replies[2].reject(new TypeError("Second response lost"));
    await assert.rejects(second, /Second response lost/);
    const third = operationFetch("/api/expenses", { amount: "3.00" });
    await waitForRequests(requests, 4);
    assert.equal(requests[3].key, secondKey);
    assert.equal(JSON.parse(requests[3].body).amount, "2.00", "resolve the uncertain second command before accepting a third");
    replies[3].resolve(Response.json({}, { status: 201 }));
    await assert.rejects(third, /ໂຫຼດໜ້າຄືນ/);
    assert.equal(requests.length, 4);
  });
});

test("a late rejected response cannot erase the same body with a newer explicit UUID", async () => {
  await environment(async ({ operationFetch, setResponse, requests, stored }) => {
    const replies = [];
    setResponse(() => { const reply = deferredResponse(); replies.push(reply); return reply.promise; });
    const originalKey = "b541b561-5a4e-4b3f-b0b0-2cc54c588747";
    const newerKey = "a1a2086e-f70f-44f2-b1bf-dd27e0b524d3";
    const payload = { amount: "1.00" };
    const first = operationFetch("/api/expenses", payload, { key: originalKey });
    await waitForRequests(requests, 1);
    const second = operationFetch("/api/expenses", payload, { key: newerKey });
    await waitForRequests(requests, 2);
    replies[1].resolve(Response.json({ retryable: false }, { status: 400 }));
    await waitForRequests(requests, 3);
    assert.equal(requests[2].key, newerKey);
    replies[0].resolve(Response.json({ retryable: false }, { status: 400 }));
    await first;
    const fingerprint = [...stored].find(([key]) => key.startsWith("yogurt:operation:"));
    assert.equal(fingerprint[1], newerKey, "retain the UUID stored at the same body fingerprint");
    const pending = JSON.parse([...stored].find(([key]) => key.startsWith("yogurt:pending-operation:"))[1]);
    assert.equal(pending.key, newerKey);
    replies[2].reject(new TypeError("Newer response lost"));
    await assert.rejects(second, /Newer response lost/);
    const retry = operationFetch("/api/expenses", payload);
    await waitForRequests(requests, 4);
    assert.equal(requests[3].key, newerKey);
    replies[3].resolve(Response.json({}, { status: 201 }));
    await retry;
    assert.equal(stored.size, 0);
  });
});

test("network loss preserves the original business body and UUID on retry", async () => {
  await environment(async ({ operationFetch, setResponse, requests, stored, invalidations }) => {
    const body = { rawMaterialId: "milk", quantity: "10.000", unitCost: "12.34" };
    setResponse(() => Promise.reject(new TypeError("Connection lost")));
    await assert.rejects(operationFetch("/api/inventory/receive", body), /Connection lost/);
    assert.equal(requests.length, 1);
    assert.match(requests[0].key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    setResponse(() => Promise.resolve(new Response("{}", { status: 201 })));
    const response = await operationFetch("/api/inventory/receive", body);
    assert.equal(response.status, 201);
    assert.equal(requests[1].key, requests[0].key);
    assert.equal(requests[1].body, requests[0].body);
    assert.equal(stored.size, 0);
    assert.equal(invalidations(), 1);
  });
});

test("editing an uncertain body first resolves the old request and requires a reload before sending new data", async () => {
  await environment(async ({ operationFetch, setResponse, requests, stored }) => {
    const original = { batchId: "batch", quantity: "5", reason: "expired" };
    setResponse(() => Promise.reject(new TypeError("Connection lost")));
    await assert.rejects(operationFetch("/api/finished-goods/adjust", original), /Connection lost/);
    setResponse(() => Promise.resolve(new Response("{}", { status: 200 })));
    await assert.rejects(operationFetch("/api/finished-goods/adjust", { ...original, quantity: "6" }), /ໂຫຼດໜ້າຄືນ/);
    assert.equal(requests.length, 2, "the changed body must not be sent during recovery");
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(stored.size, 0, "a resolved original request must no longer be pending");
  });
});

test("disabled persistent storage still preserves an in-memory retry UUID", async () => {
  await environment(async ({ operationFetch, setResponse, requests }) => {
    const original = { category: "electricity", amount: "14000.70" };
    setResponse(() => Promise.reject(new TypeError("Connection lost")));
    await assert.rejects(operationFetch("/api/expenses", original), /Connection lost/);
    setResponse(() => Promise.resolve(new Response("{}", { status: 201 })));
    await operationFetch("/api/expenses", original);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].key, requests[0].key);
    assert.equal(requests[1].body, requests[0].body);
  }, { disabledStorage: true });
});

test("a different signed-in user never replays the previous user's uncertain command", async () => {
  for (const amount of ["1234.50", "2000.50"]) {
  await environment(async ({ operationFetch, setResponse, requests, setUser }) => {
    const original = { category: "electricity", amount: "1234.50" };
    setResponse(() => Promise.reject(new TypeError("Response lost after server commit")));
    await assert.rejects(operationFetch("/api/expenses", original), /Response lost/);
    const firstKey = requests[0].key;
    setUser("user-b");
    setResponse(() => Promise.resolve(new Response("{}", { status: 201 })));
    await operationFetch("/api/expenses", { ...original, amount });
    assert.equal(requests.length, 2);
    assert.notEqual(requests[1].key, firstKey);
    assert.equal(JSON.parse(requests[1].body).amount, amount);
    setUser("user-a");
    await operationFetch("/api/expenses", original);
    assert.equal(requests[2].key, firstKey, "the original user can still recover their own operation");
  });
  }
});

test("an unresolved server response preserves the old operation and blocks an edited body", async () => {
  await environment(async ({ operationFetch, setResponse, requests }) => {
    const original = { rawMaterialId: "milk", quantity: "5" };
    setResponse(() => Promise.resolve(new Response(JSON.stringify({ retryable: true }), { status: 503 })));
    assert.equal((await operationFetch("/api/inventory/receive", original)).status, 503);
    await assert.rejects(operationFetch("/api/inventory/receive", { ...original, quantity: "6" }), /ຍັງຢືນຢັນ/);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0]);
  });
});

test("a definitive validation failure allows corrected data with a new operation key", async () => {
  await environment(async ({ operationFetch, setResponse, requests }) => {
    setResponse(() => Promise.resolve(new Response(JSON.stringify({ error: "Invalid quantity", retryable: false }), { status: 400 })));
    assert.equal((await operationFetch("/api/inventory/receive", { quantity: "-1" })).status, 400);
    setResponse(() => Promise.resolve(new Response("{}", { status: 201 })));
    assert.equal((await operationFetch("/api/inventory/receive", { quantity: "5" })).status, 201);
    assert.equal(requests.length, 2);
    assert.notEqual(requests[1].key, requests[0].key);
    assert.equal(JSON.parse(requests[1].body).quantity, "5");
  });
});

test("authentication and user password bodies are never written to persistent storage", async () => {
  for (const [url, method] of [["/api/auth/login", "POST"], ["/api/users", "POST"], ["/api/users/test-user", "PATCH"]]) {
    await environment(async ({ operationFetch, setResponse, requests, stored, writes }) => {
      const body = { email: "private@example.test", password: "never-persist-this-password" };
      setResponse(() => Promise.reject(new TypeError("Connection lost")));
      await assert.rejects(operationFetch(url, body, { method }), /Connection lost/);
      assert.equal(requests[0].body, JSON.stringify(body), "the password is still submitted to its intended API");
      assert.equal(stored.size, 1, "only a request UUID may persist");
      for (const [key, value] of writes) {
        assert.match(key, /^yogurt:operation:[0-9a-f]{64}$/);
        assert.match(value, /^[0-9a-f-]{36}$/i);
        assert.equal(value.includes(body.password), false);
        assert.equal(value.includes(body.email), false);
      }
    });
  }
});
