import test from "node:test";
import assert from "node:assert/strict";
import { getDashboardAttentionSummary } from "../src/lib/dashboard-summary.ts";

const clearData = { dueStores: 0, refills: [], lowMaterials: [], outstanding: 0 };
const alert = (id, type = "warning", title = id) => ({ id, type, title, detail: `${id} details`, href: `/${id}` });

test("a busy dashboard keeps every attention category and uses full totals beyond notification previews", () => {
  const data = {
    dueStores: 7,
    refills: [
      { status: "waiting" },
      { status: "preparing" },
      { status: "delivering" },
      { status: "completed" },
      { status: "cancelled" },
    ],
    lowMaterials: Array.from({ length: 8 }, (_, index) => ({ id: `material-${index}` })),
    outstanding: 175000,
  };
  const alerts = [
    ...Array.from({ length: 4 }, (_, index) => alert(`due-store-${index}`, "urgent")),
    alert("due-stores-more", "urgent"),
    alert("refills", "urgent"),
    ...Array.from({ length: 5 }, (_, index) => alert(`material-${index}`)),
    alert("receivables"),
    alert("expiring", "warning", "3 ລັອດຜະລິດໃກ້ໝົດອາຍຸ"),
    alert("maintenance", "info", "2 ຕູ້ຢູ່ສະຖານະບຳລຸງຮັກສາ"),
  ];

  const summary = getDashboardAttentionSummary(data, alerts);
  const categories = new Map(summary.map((item) => [item.key, item]));

  assert.equal(summary.length, 6);
  assert.equal(categories.size, 6);
  assert.equal(categories.get("due-stores").value, 7);
  assert.equal(categories.get("refills").value, 2);
  assert.equal(categories.get("materials").value, 8);
  assert.equal(categories.get("receivables").value, 175000);
  assert.equal(categories.get("receivables").unit, "LAK");
  assert.deepEqual(summary.filter((item) => item.tone === "urgent").map((item) => item.key), ["due-stores", "refills"]);
  assert.equal(categories.get("expiring").label, alerts.at(-2).title);
  assert.equal(categories.get("maintenance").label, alerts.at(-1).title);
});

test("expiry and maintenance remain actionable without guessing counts from localized titles", () => {
  const alerts = [
    alert("all-clear", "info"),
    alert("expiring", "warning", "ມີລັອດຜະລິດທີ່ຄວນຈັດການ"),
    alert("maintenance", "info", "ມີຕູ້ທີ່ຄວນບຳລຸງຮັກສາ"),
  ];
  const summary = getDashboardAttentionSummary(clearData, alerts);

  assert.deepEqual(summary.map((item) => item.key), ["expiring", "maintenance"]);
  assert.ok(summary.length > 0);
  assert.ok(summary.every((item) => item.value === undefined));
  assert.equal(summary[0].detail, alerts[1].detail);
  assert.equal(summary[1].href, alerts[2].href);
});

test("all-clear and refills already out for delivery do not create attention categories", () => {
  const data = { ...clearData, refills: [{ status: "delivering" }, { status: "completed" }, { status: "cancelled" }] };
  assert.deepEqual(getDashboardAttentionSummary(data, [alert("all-clear", "info")]), []);
});
