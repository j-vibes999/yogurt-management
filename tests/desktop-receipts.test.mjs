import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { importReceipts } from "../desktop/import-receipts.cjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWO4w8UFAAK2APG8J2s+AAAAAElFTkSuQmCC", "base64");
const jpeg = Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbAC68P//Z", "base64");
const webp = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+9Bi3/kFywuuRr/5Af8gP+QH/8XMAAAA=", "base64");
const pdf = Buffer.from("%PDF-1.7\nsynthetic receipt\nstartxref\n0\n%%EOF\n");

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "yogurt-desktop-receipts-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, "source");
  await fs.mkdir(sourceDirectory);
  const directory = path.join(root, "userData", "runtime");
  return { root, sourceDirectory, directory, destination: path.join(directory, "private-receipts") };
}

test("receipt import verifies private copies and keeps source bytes in place", async (t) => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.sourceDirectory, "receipt-first.png"), png);
  await fs.writeFile(path.join(options.sourceDirectory, "receipt-second.pdf"), pdf);
  assert.deepEqual(await importReceipts(options), { copied: 2, skipped: 0 });
  for (const [name, bytes] of [["receipt-first.png", png], ["receipt-second.pdf", pdf]]) {
    assert.deepEqual(await fs.readFile(path.join(options.destination, name)), bytes);
    assert.deepEqual(await fs.readFile(path.join(options.sourceDirectory, name)), bytes);
    assert.equal((await fs.lstat(path.join(options.destination, name))).mode & 0o777, 0o600);
  }
  assert.equal((await fs.lstat(options.directory)).mode & 0o777, 0o700);
  assert.equal((await fs.lstat(options.destination)).mode & 0o777, 0o700);
  assert.deepEqual((await fs.readdir(options.destination)).sort(), ["receipt-first.png", "receipt-second.pdf"]);
});

test("receipt import skips identical checksums and safely resumes after a completed copy", async (t) => {
  const options = await fixture(t);
  const name = "receipt-same.png";
  await fs.writeFile(path.join(options.sourceDirectory, name), png);
  assert.deepEqual(await importReceipts(options), { copied: 1, skipped: 0 });
  const before = await fs.lstat(path.join(options.destination, name));
  assert.deepEqual(await importReceipts(options), { copied: 0, skipped: 1 });
  assert.equal((await fs.lstat(path.join(options.destination, name))).ino, before.ino);
  assert.deepEqual(await fs.readFile(path.join(options.sourceDirectory, name)), png);
});

test("a conflicting receipt destination is never overwritten or removed", async (t) => {
  const options = await fixture(t);
  const name = "receipt-conflict.png";
  await fs.writeFile(path.join(options.sourceDirectory, name), png);
  await fs.mkdir(options.destination, { recursive: true });
  await fs.writeFile(path.join(options.destination, name), pdf);
  await assert.rejects(importReceipts(options));
  assert.deepEqual(await fs.readFile(path.join(options.destination, name)), pdf);
  assert.deepEqual(await fs.readFile(path.join(options.sourceDirectory, name)), png);
});

test("an interrupted publish leaves no partial final receipt and can be retried", async (t) => {
  const options = await fixture(t);
  const name = "receipt-interrupted.png";
  await fs.writeFile(path.join(options.sourceDirectory, name), png);
  const interrupted = t.mock.method(fs, "link", async () => { throw new Error("synthetic interrupted publish"); });
  await assert.rejects(importReceipts(options), (error) => !error.message.includes("synthetic"));
  interrupted.mock.restore();
  assert.deepEqual(await fs.readdir(options.destination), []);
  assert.deepEqual(await fs.readFile(path.join(options.sourceDirectory, name)), png);
  assert.deepEqual(await importReceipts(options), { copied: 1, skipped: 0 });
});

test("checksum verification refuses corrupted staging bytes before publication", async (t) => {
  const options = await fixture(t);
  const name = "receipt-checksum.png";
  await fs.writeFile(path.join(options.sourceDirectory, name), png);
  const realOpen = fs.open.bind(fs);
  const corrupt = t.mock.method(fs, "open", async (...args) => {
    const handle = await realOpen(...args);
    if (String(args[0]).endsWith(".tmp")) {
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async () => originalWrite(Buffer.from("truncated"));
    }
    return handle;
  });
  await assert.rejects(importReceipts(options));
  corrupt.mock.restore();
  assert.deepEqual(await fs.readdir(options.destination), []);
  assert.deepEqual(await fs.readFile(path.join(options.sourceDirectory, name)), png);
});

test("an abandoned temporary file cannot masquerade as a completed receipt", async (t) => {
  const options = await fixture(t);
  const name = "receipt-resume.png";
  await fs.writeFile(path.join(options.sourceDirectory, name), png);
  await fs.mkdir(options.destination, { recursive: true });
  await fs.writeFile(path.join(options.destination, ".receipt-import-abandoned.tmp"), "partial");
  assert.deepEqual(await importReceipts(options), { copied: 1, skipped: 0 });
  assert.deepEqual(await fs.readFile(path.join(options.destination, name)), png);
});

test("receipt source and destination symlinks are refused without changing their targets", async (t) => {
  const options = await fixture(t);
  const name = "receipt-link.png";
  const original = path.join(options.root, "original.png");
  await fs.writeFile(original, png);
  await fs.symlink(original, path.join(options.sourceDirectory, name));
  await assert.rejects(importReceipts(options));
  await fs.rm(path.join(options.sourceDirectory, name));
  await fs.writeFile(path.join(options.sourceDirectory, name), png);
  await fs.mkdir(options.destination, { recursive: true });
  await fs.symlink(original, path.join(options.destination, name));
  await assert.rejects(importReceipts(options));
  assert.deepEqual(await fs.readFile(original), png);
  await fs.rm(options.destination, { recursive: true });
  await fs.symlink(options.sourceDirectory, options.destination);
  await assert.rejects(importReceipts(options));
  const sourceLink = path.join(options.root, "source-link");
  await fs.symlink(options.sourceDirectory, sourceLink);
  await assert.rejects(importReceipts({ ...options, sourceDirectory: sourceLink }));
});

test("unexpected names, disguised content, and oversized receipts stop import", async (t) => {
  const options = await fixture(t);
  for (const [name, bytes] of [["other.png", png], ["receipt-fake.png", pdf], ["receipt-truncated.png", png.subarray(0, -1)], ["receipt-large.png", Buffer.alloc(5 * 1024 * 1024 + 1)]]) {
    await fs.writeFile(path.join(options.sourceDirectory, name), bytes);
    await assert.rejects(importReceipts(options));
    assert.deepEqual(await fs.readFile(path.join(options.sourceDirectory, name)), bytes);
    await fs.rm(path.join(options.sourceDirectory, name));
  }
});

test("JPEG and WebP receipts retain their validated format during import", async (t) => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.sourceDirectory, "receipt-photo.jpeg"), jpeg);
  await fs.writeFile(path.join(options.sourceDirectory, "receipt-image.webp"), webp);
  assert.deepEqual(await importReceipts(options), { copied: 2, skipped: 0 });
  assert.deepEqual(await fs.readFile(path.join(options.destination, "receipt-photo.jpeg")), jpeg);
  assert.deepEqual(await fs.readFile(path.join(options.destination, "receipt-image.webp")), webp);
});
