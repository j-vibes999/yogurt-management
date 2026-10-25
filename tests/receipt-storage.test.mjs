import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isSafeReceiptName, MAX_RECEIPT_BYTES, openReceipt, privateReceiptDirectory, storeReceipt, validReceiptContent } from "../src/lib/receipt-storage.ts";

// Golden 1 x 1 images encoded with the installed image library, stored directly
// so these tests need no decoder, network, browser or live receipt files.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWO4w8UFAAK2APG8J2s+AAAAAElFTkSuQmCC", "base64");
const jpeg = Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbAC68P//Z", "base64");
const webp = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+9Bi3/kFywuuRr/5Af8gP+QH/8XMAAAA=", "base64");

test("receipt content matches its declared type and rejects truncated or disguised files", () => {
  for (const [bytes, type] of [[png, "image/png"], [jpeg, "image/jpeg"], [webp, "image/webp"]]) {
    assert.equal(validReceiptContent(bytes, type), true, type);
    assert.equal(validReceiptContent(bytes.subarray(0, bytes.length - 1), type), false, `truncated ${type}`);
  }
  assert.equal(validReceiptContent(png, "image/jpeg"), false);
  assert.equal(validReceiptContent(Buffer.from("<html>fake JPEG</html>"), "image/jpeg"), false);
  const forgedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0xff, 0xda, 0, 0, 0, 0, 0, 0xff, 0xd9]);
  assert.equal(validReceiptContent(forgedJpeg, "image/jpeg"), false);
  const metadataOnlyWebp = Buffer.alloc(30);
  metadataOnlyWebp.write("RIFF", 0); metadataOnlyWebp.writeUInt32LE(22, 4); metadataOnlyWebp.write("WEBPVP8X", 8); metadataOnlyWebp.writeUInt32LE(10, 16);
  assert.equal(validReceiptContent(metadataOnlyWebp, "image/webp"), false);
  assert.equal(validReceiptContent(Buffer.alloc(MAX_RECEIPT_BYTES + 1), "image/png"), false);
  assert.equal(validReceiptContent(png, "image/svg+xml"), false);
});

test("safe receipt filenames prevent path traversal and unexpected file types", () => {
  assert.equal(isSafeReceiptName("receipt-legacy-123.png"), true);
  for (const name of ["../receipt-123.png", "receipt-123.svg", "receipt-123.png/other", "receipt-123.png\0", "receipt-123.PNG", "receipt-" + "a".repeat(150) + ".png"]) assert.equal(isSafeReceiptName(name), false, name);
});

test("new receipts are immediately readable from private storage and reject symlink targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yogurt-receipt-test-"));
  try {
    const receipt = await storeReceipt(png, "image/png", root);
    assert.match(receipt.url, /^\/api\/receipts\/receipt-[a-f0-9-]+\.png$/);
    const directory = privateReceiptDirectory(root);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(directory, receipt.name))).mode & 0o777, 0o600);
    const opened = await openReceipt(receipt.name, root);
    assert.ok(opened);
    try { assert.deepEqual(await opened.handle.readFile(), png); } finally { await opened.handle.close(); }
    await assert.rejects(readFile(path.join(root, "public", "uploads", "receipts", receipt.name)), { code: "ENOENT" });
    const outside = path.join(root, "outside.png");
    await writeFile(outside, png);
    await symlink(outside, path.join(directory, "receipt-symlink.png"));
    assert.equal(await openReceipt("receipt-symlink.png", root), null);
    assert.equal(await openReceipt("../outside.png", root), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy receipt migration verifies copied bytes and safely reruns", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yogurt-receipt-migration-test-"));
  const script = path.resolve("scripts/migrate-private-receipts.mjs");
  try {
    const source = path.join(root, "public", "uploads", "receipts");
    await mkdir(source, { recursive: true });
    const name = "receipt-old-123.png";
    await writeFile(path.join(source, name), png);
    const dry = JSON.parse(execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" }));
    assert.deepEqual(dry, { mode: "dry-run", receipts: 1, moved: 0 });
    const before = await openReceipt(name, root);
    assert.ok(before); await before.handle.close();
    const applied = JSON.parse(execFileSync(process.execPath, [script, "--apply"], { cwd: root, encoding: "utf8" }));
    assert.equal(applied.moved, 1);
    assert.deepEqual(await readFile(path.join(privateReceiptDirectory(root), name)), png);
    await assert.rejects(readFile(path.join(source, name)), { code: "ENOENT" });
    const again = JSON.parse(execFileSync(process.execPath, [script, "--apply"], { cwd: root, encoding: "utf8" }));
    assert.equal(again.moved, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
