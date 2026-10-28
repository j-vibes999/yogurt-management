import test from "node:test";
import assert from "node:assert/strict";
import { restockDraftContent, restoreRestockDraft } from "../src/lib/restock-draft.ts";
import { fetchSearchResults, createSearchRequest } from "../src/lib/search-request.ts";
import { shouldWarnForLink } from "../src/lib/navigation-guard.ts";
import { createPendingStorage } from "../src/lib/pending-request.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const context = {
  storeId: "store-a", fridgeAssetCode: "FR-01", previousBalance: 120, commissionRate: 30,
  snapshot: [["yogurt-a", 8, 2, 20]],
};
const values = { entries: { "yogurt-a": { countRemaining: "5", countExpiredReturned: "1", countRefilled: 2 } }, paymentMethod: "cash", paidAmount: "12.50" };

test("draft identity includes every edited payment and stock value", () => {
  const original = restockDraftContent(context, values);
  for (const change of [{ paidAmount: "13.50" }, { paymentMethod: "bank" }, { entries: { "yogurt-a": { ...values.entries["yogurt-a"], countRemaining: "4" } } }]) {
    assert.notEqual(restockDraftContent(context, { ...values, ...change }), original);
  }
  const restored = restoreRestockDraft(original, context);
  assert.equal(restored.status, "valid");
  assert.deepEqual(restored.values, values);
});

test("restoring a draft rejects stale financial and stock snapshots", () => {
  const saved = restockDraftContent(context, values);
  for (const change of [{ previousBalance: 121 }, { commissionRate: 25 }, { snapshot: [["yogurt-a", 9, 2, 20]] }, { fridgeAssetCode: "FR-02" }]) {
    assert.equal(restoreRestockDraft(saved, { ...context, ...change }).status, "stale");
  }
  assert.equal(restoreRestockDraft("{broken", context).status, "invalid");
  assert.equal(restoreRestockDraft(null, context).status, "empty");
});

test("draft restoration refuses malformed entries and payment fields", () => {
  for (const change of [{ paidAmount: false }, { paymentMethod: "unknown" }, { entries: {} }]) {
    assert.equal(restoreRestockDraft(JSON.stringify({ ...context, ...values, ...change }), context).status, "invalid");
  }
});

test("an in-memory draft recovered after blocked storage cannot claim browser persistence", () => {
  const storage = createPendingStorage(() => { throw new Error("Storage disabled"); });
  const content = restockDraftContent(context, values);
  assert.equal(storage.write("draft", content), false);
  assert.equal(storage.read("draft"), content);
  assert.equal(storage.isPersisted("draft", content), false);
});

test("search distinguishes failed requests from an empty successful search", async () => {
  await assert.rejects(fetchSearchResults("milk", undefined, async () => new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 })), /Unavailable/);
  await assert.rejects(fetchSearchResults("milk", undefined, async () => new Response("{}")), /ຄົ້ນຫາ/);
  assert.deepEqual(await fetchSearchResults("milk", undefined, async () => new Response(JSON.stringify({ results: [] }))), []);
});

test("superseded search generations cannot update the active query", () => {
  const gate = createSearchRequest();
  const first = gate.next();
  const second = gate.next();
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  gate.cancel();
  assert.equal(second.isCurrent(), false);
});

function navigationHookFixture() {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const states = [], refs = [], effects = [], pendingEffects = [], windowListeners = new Map(), documentListeners = new Map(), pushes = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, firstRender = true;
  const react = {
    useState(initial) { const index = stateIndex++; if (firstRender) states[index] = initial; return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useRef(initial) { const index = refIndex++; if (firstRender) refs[index] = { current: initial }; return refs[index]; },
    useCallback: callback => callback,
    useEffect: (callback, dependencies) => { const index = effectIndex++; if (!effects[index] || dependencies.some((value, position) => !Object.is(value, effects[index].dependencies[position]))) pendingEffects.push({ index, callback, dependencies }); },
    createElement: (type, props) => ({ type, props }),
  };
  const exports = {};
  const router = { push: href => pushes.push(href) };
  class Element { closest() { return { href: "https://yogurt.example/stores", target: "", hasAttribute: () => false }; } }
  const context = {
    exports, module: { exports }, URL, Element,
    window: { location: { href: "https://yogurt.example/driver/restock/a", origin: "https://yogurt.example" }, addEventListener: (type, listener) => windowListeners.set(type, listener), removeEventListener: type => windowListeners.delete(type) },
    document: { addEventListener: (type, listener) => documentListeners.set(type, listener), removeEventListener: type => documentListeners.delete(type) },
    require(name) { return ({ react, "next/navigation": { useRouter: () => router }, "@/components/action-dialog": { ActionDialog: () => null }, "./navigation-guard": { shouldWarnForLink } })[name]; },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/use-unsaved-changes.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return {
    render(dirty) { stateIndex = 0; refIndex = 0; effectIndex = 0; const hook = exports.useUnsavedChanges(dirty); for (const effect of pendingEffects.splice(0)) { effects[effect.index]?.cleanup?.(); effects[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() }; } firstRender = false; return hook; },
    click() { const event = { target: new Element(), button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} }; documentListeners.get("click")(event); return event; },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; windowListeners.get("beforeunload")(event); return event; },
    cleanup: () => effects.forEach(effect => effect.cleanup?.()), pushes,
  };
}

test("dirty navigation preserves values on cancel and routes only after dialog confirmation", () => {
  const fixture = navigationHookFixture();
  let hook = fixture.render(true);
  assert.equal(fixture.unload().prevented, true);
  assert.equal(fixture.click().defaultPrevented, true);
  hook = fixture.render(true);
  assert.equal(hook.navigationDialog.props.open, true);
  hook.navigationDialog.props.onClose();
  assert.equal(fixture.render(true).navigationDialog.props.open, false);
  assert.deepEqual(fixture.pushes, []);
  fixture.click();
  fixture.render(true).navigationDialog.props.onConfirm();
  assert.deepEqual(fixture.pushes, ["/stores"]);
  fixture.cleanup();
});

test("pristine and successful forms navigate without dialogs; surviving dirty forms regain protection", () => {
  const fixture = navigationHookFixture();
  fixture.render(false);
  assert.equal(fixture.click().defaultPrevented, false);
  assert.equal(fixture.unload().prevented, false);
  const hook = fixture.render(true);
  hook.allowNavigation();
  assert.equal(fixture.unload().prevented, false);
  fixture.render(true);
  assert.equal(fixture.unload().prevented, true);
  let discarded = false;
  fixture.render(false).requestDiscard(() => { discarded = true; });
  assert.equal(discarded, true);
  fixture.cleanup();
});

test("finishing an autosave while discard confirmation is open allows the requested navigation", () => {
  const fixture = navigationHookFixture();
  fixture.render(true);
  fixture.click();
  assert.equal(fixture.render(true).navigationDialog.props.open, true);
  fixture.render(false);
  assert.deepEqual(fixture.pushes, ["/stores"]);
  assert.equal(fixture.render(false).navigationDialog.props.open, false);
  fixture.cleanup();
});

test("navigation warnings apply only to page-changing links in the same tab", () => {
  const current = "https://yogurt.example/driver/restock/a";
  const click = { button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(shouldWarnForLink(current, "/stores", {}, click), true);
  assert.equal(shouldWarnForLink(current, "?mode=payment", {}, click), true);
  assert.equal(shouldWarnForLink(current, "#counts", {}, click), false);
  assert.equal(shouldWarnForLink(current, "/stores", { target: "_blank" }, click), false);
  assert.equal(shouldWarnForLink(current, "/stores", {}, { ...click, ctrlKey: true }), false);
  assert.equal(shouldWarnForLink(current, "tel:0200000000", {}, click), false);
  assert.equal(shouldWarnForLink(current, "/receipt.csv", { download: true }, click), false);
});
