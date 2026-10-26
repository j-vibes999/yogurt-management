import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { canRoleOpen } from "../src/lib/access-policy.ts";

const read = (p) => fs.readFileSync(p, "utf8");

test("roles only get links to pages they can open", () => {
  assert.equal(canRoleOpen("production", "/settlements"), false);
  assert.equal(canRoleOpen("driver", "/inventory"), false);
  assert.equal(canRoleOpen("driver", "/expenses/new"), false);
  assert.equal(canRoleOpen("driver", "/driver/restock/store-1"), true);
  assert.equal(canRoleOpen("production", "/production?tab=batches"), true);
  assert.equal(canRoleOpen("admin", "/reports"), true);
  assert.equal(canRoleOpen(null, "/stores"), true);
  assert.equal(canRoleOpen(null, "/reports"), false);
  for (const file of ["src/app/page.tsx", "src/app/notifications/page.tsx", "src/app/api/search/route.ts", "src/app/api/shell-state/route.ts", "src/app/api/notifications/count/route.ts"]) {
    assert.match(read(file), /canRoleOpen/, `${file} must filter by role`);
  }
});

test("reports subtract returned-cup and central write-off costs from profit", () => {
  const data = read("src/lib/db-data.ts");
  assert.match(data, /expired_cost/);
  assert.match(data, /finished_goods_adjustments/);
  assert.match(data, /netProfit:moneyValue\(monthGross-storeShare-productCost-wasteCost-expenseTotal\)/);
});

test("the store audit page and the audit API count the same fridge rows", () => {
  const filter = "fridgeInventory: { where: { fridge: { currentStoreId: storeId } }";
  assert.ok(read("src/lib/db-data.ts").includes(filter));
  assert.ok(read("src/app/api/restock-visits/route.ts").includes(filter));
});

test("launchd jobs find their scripts and the server start script uses the project folder", () => {
  for (const file of ["scripts/health-check.sh", "scripts/backup-db.sh", "scripts/verify-backup-restore.sh", "scripts/server-control.sh", "scripts/lib-env.sh"]) assert.ok(fs.existsSync(file), file);
  assert.match(read("Apply Yogurt Update.command"), /migrate deploy/);
  assert.doesNotMatch(read("scripts/backup-db.sh"), /dotenv/);
});
