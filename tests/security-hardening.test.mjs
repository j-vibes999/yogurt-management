import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { checkLoginRateLimit, loginIpRateKey, loginRateKey, recordLoginFailure, recordLoginSuccess, resetLoginRateLimitForTests } from "../src/lib/login-rate-limit.ts";

const read=(p)=>fs.readFileSync(p,"utf8");

test("login limiter blocks repeated failures and success clears the bucket",()=>{
  resetLoginRateLimitForTests();
  const key=loginRateKey("127.0.0.1","User@Example.com");
  for(let i=0;i<10;i++) recordLoginFailure(key,1_000);
  assert.equal(checkLoginRateLimit(key,1_001).allowed,false);
  assert.ok(checkLoginRateLimit(key,1_001).retryAfter>0);
  recordLoginSuccess(key);
  assert.equal(checkLoginRateLimit(key,1_002).allowed,true);
});



test("login limiter can cap one IP across rotating email addresses",()=>{
  resetLoginRateLimitForTests();
  const ipKey=loginIpRateKey("203.0.113.7");
  for(let i=0;i<10;i++) {
    recordLoginFailure(loginRateKey("203.0.113.7",`user${i}@example.com`),2_000);
    recordLoginFailure(ipKey,2_000);
  }
  assert.equal(checkLoginRateLimit(ipKey,2_001).allowed,false);
});

test("login limiter key normalizes email casing",()=>{
  assert.equal(loginRateKey("1.2.3.4"," A@B.COM "),loginRateKey("1.2.3.4","a@b.com"));
});

test("middleware keeps cross-site mutation and security-header guards",()=>{
  const source=read("middleware.ts");
  for(const marker of ["sec-fetch-site","ຄຳຂໍຈາກເວັບໄຊອື່ນຖືກປິດກັ້ນ","X-Content-Type-Options","X-Frame-Options","Permissions-Policy","/api/health"]) assert.ok(source.includes(marker),`missing ${marker}`);
});

test("database integrity migration protects core accounting and stock quantities",()=>{
  const sql=read("prisma/migrations/20260924193000_integrity_constraints/migration.sql");
  for(const marker of ["raw_materials_nonnegative_stock_cost_ck","production_batches_quantity_cost_ck","fridge_inventory_nonnegative_stock_ck","settlements_nonnegative_amounts_ck"]) assert.ok(sql.includes(marker),`missing ${marker}`);
});

test("backup and restore verification scripts are present",()=>{
  for(const file of ["scripts/backup-db.sh","scripts/verify-backup-restore.sh","scripts/health-check.sh"]) assert.ok(fs.existsSync(file),`missing ${file}`);
  assert.ok(read("scripts/backup-db.sh").includes("pg_restore --list"));
  const restore=read("scripts/verify-backup-restore.sh");
  assert.ok(restore.includes("pg_restore --no-owner --no-acl --exit-on-error"));
  assert.ok(restore.includes('ACTUAL_HASH=$(shasum -a 256 "$BACKUP"'));
  for(const marker of ["FRIDGE_NEG", "BATCH_INVALID", "SETTLEMENT_INVALID"]) assert.ok(restore.includes(marker),`missing ${marker}`);
});

test("real-user Web Vitals stay local and exclude user identity",()=>{
  const reporter=read("src/components/web-vitals-reporter.tsx");
  const route=read("src/app/api/metrics/web-vitals/route.ts");
  assert.ok(reporter.includes("useReportWebVitals"));
  assert.ok(route.includes("web-vitals.ndjson"));
  assert.ok(!reporter.includes("email"));
  assert.ok(!reporter.includes("userId"));
});
