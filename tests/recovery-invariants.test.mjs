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

test("store pages and delivery counts only use the fridge that is at the store now", () => {
  assert.ok(read("src/app/stores/[id]/page.tsx").includes("fridgeInventory: { where: { fridge: { currentStoreId: id } }"));
  assert.match(read("src/lib/refill-summary.ts"), /JOIN fridges f ON f\.id = inv\.fridge_id AND f\.current_store_id = inv\.store_id/);
  // Rows added when a fridge moves start counting deliveries from the move, like the rows that moved with it.
  assert.match(read("src/app/api/fridges/[id]/route.ts"), /currentStock: 0, lastAuditDate: movedAt/);
});

test("refill errors are in Lao and name the product", () => {
  const route = read("src/app/api/refills/[id]/route.ts");
  assert.doesNotMatch(route, /Fridge capacity exceeded|Central stock is insufficient/);
  assert.match(route, /product\?\.name \?\? productId/);
});

test("notifications warn about expired stock in the central store and in store fridges", () => {
  const data = read("src/lib/db-data.ts");
  assert.match(data, /id:"expired-batches"/);
  assert.match(data, /id:"expired-in-fridges"/);
  assert.match(data, /expDate:\{lt:now\}/);
  // The bell badge counts the same alerts.
  const shell = read("src/app/api/shell-state/route.ts");
  assert.match(shell, /expired_count/);
  assert.match(shell, /expired_fridge_store_count/);
});

test("keep-awake only holds the Mac awake on mains power and can be turned off", () => {
  const script = read("scripts/keep-awake.sh");
  assert.match(script, /<string>\/usr\/bin\/caffeinate<\/string><string>-s<\/string>/);
  assert.match(script, /off\)\n    launchctl bootout/);
  for (const mode of ["On", "Off"]) assert.ok(fs.existsSync(`Keep Mac Awake - ${mode}.command`));
});

test("the Supabase copy never prints the password and checks every table", () => {
  const lib = read("scripts/lib-supabase.sh");
  const script = read("scripts/copy-db-to-supabase.sh");
  assert.match(lib, /IFS= read -rs _pw/);
  assert.match(lib, /encodeURIComponent\(pw\)/);
  assert.match(lib, /sslmode", "require"/);
  assert.match(script, /diff "\$WORK\/mac.txt" "\$WORK\/supabase.txt"/);
  for (const text of [lib, script, read("scripts/move-to-supabase.sh")]) assert.doesNotMatch(text, /echo[^\n]*\$(TARGET|_pw|APP_URL)/);
  assert.match(read(".gitignore"), /^\.yogurt\/$/m);
});

test("moving to Supabase keeps only the set-up data, backs up first and can go back", () => {
  const move = read("scripts/move-to-supabase.sh");
  assert.match(move, /KEEP="'_prisma_migrations','users','finished_products','recipes','recipe_items','raw_materials','expense_categories'"/);
  assert.match(move, /UPDATE raw_materials SET current_stock = 0/);
  assert.ok(move.indexOf("backup-db.sh") < move.indexOf("copy_database \"$LOCAL\""), "backup before copying");
  assert.match(move, /cp -p "\$STATE\/env-before-supabase" \.env/);
  assert.match(move, /LOCAL_DATABASE_URL=/);
  // After the move the Mac copy must never be pushed over the live data, and scratch databases stay on this Mac.
  assert.match(read("scripts/copy-db-to-supabase.sh"), /\^LOCAL_DATABASE_URL=/);
  for (const file of ["scripts/verify-backup-restore.sh", "scripts/run-business-e2e.sh", "scripts/disaster-recovery-drill.sh"]) assert.match(read(file), /local_database_url/, file);
  for (const file of ["scripts/backup-db.sh", "scripts/verify-backup-restore.sh"]) assert.match(read(file), /pg_client_path/, file);
});

test("launchd jobs find their scripts and the server start script uses the project folder", () => {
  for (const file of ["scripts/health-check.sh", "scripts/backup-db.sh", "scripts/verify-backup-restore.sh", "scripts/server-control.sh", "scripts/lib-env.sh"]) assert.ok(fs.existsSync(file), file);
  assert.match(read("Apply Yogurt Update.command"), /migrate deploy/);
  assert.doesNotMatch(read("scripts/backup-db.sh"), /dotenv/);
});
