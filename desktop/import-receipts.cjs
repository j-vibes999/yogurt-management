"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const receiptNamePattern = /^receipt-[A-Za-z0-9-]+\.(?:jpg|jpeg|png|webp|pdf)$/;
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receiptError = () => new Error("Private receipts could not be imported securely.");

async function directoryAt(directory, create = false, makePrivate = false) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw receiptError();
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let info;
    try { info = await fs.lstat(current); } catch (error) {
      if (!create || error.code !== "ENOENT") throw error;
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      info = await fs.lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw receiptError();
  }
  const info = await fs.lstat(resolved);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw receiptError();
  if (makePrivate) await fs.chmod(resolved, 0o700);
  return resolved;
}

// Match the web receipt store's structural checks without importing source TS
// into Electron's main process or including application source in the package.
function validPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let imageData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + length + 12;
    if (end > bytes.length || (offset === 8 && (type !== "IHDR" || length !== 13))) return false;
    if (type === "IHDR" && (length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12))) return false;
    if (type === "IDAT" && length > 0) imageData = true;
    if (type === "IEND") return imageData && length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function validJpeg(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  let frameComponents = 0;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0x01) continue;
    if (marker === 0 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length - 2) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) return false;
      frameComponents = bytes[offset + 7];
      if (!frameComponents || frameComponents > 4 || length !== 8 + frameComponents * 3) return false;
    }
    if (marker === 0xda) {
      const scanComponents = bytes[offset + 2];
      return frameComponents > 0 && scanComponents > 0 && scanComponents <= frameComponents
        && length === 6 + scanComponents * 2 && end < bytes.length - 2;
    }
    offset = end;
  }
  return false;
}

function validWebpChunks(bytes, start, limit, insideFrame = false) {
  let hasImage = false;
  for (let offset = start; offset < limit;) {
    if (offset + 8 > limit) return false;
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + length;
    const paddedEnd = end + (length % 2);
    if (paddedEnd > limit) return false;
    if (type === "VP8 ") {
      if (length < 10 || (bytes[payload] & 1) !== 0 || !bytes.subarray(payload + 3, payload + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))
        || !(bytes.readUInt16LE(payload + 6) & 0x3fff) || !(bytes.readUInt16LE(payload + 8) & 0x3fff)) return false;
      hasImage = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[payload] !== 0x2f || bytes.readUInt32LE(payload + 1) >>> 29 !== 0) return false;
      hasImage = true;
    } else if (type === "VP8X" && length !== 10) return false;
    else if (type === "ANMF") {
      if (insideFrame || length <= 16 || !validWebpChunks(bytes, payload + 16, end, true)) return false;
      hasImage = true;
    }
    offset = paddedEnd;
  }
  return hasImage;
}

function validReceipt(bytes, name) {
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) return false;
  const extension = path.extname(name);
  if (extension === ".png") return validPng(bytes);
  if (extension === ".jpg" || extension === ".jpeg") return validJpeg(bytes);
  if (extension === ".webp") {
    return bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF"
      && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length
      && validWebpChunks(bytes, 12, bytes.length);
  }
  return extension === ".pdf" && /^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.toString("ascii", 0, 8))
    && /startxref\s+\d+\s+%%EOF\s*$/.test(bytes.toString("latin1", Math.max(0, bytes.length - 1024)));
}

async function readReceipt(filename, makePrivate = false) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size === 0 || before.size > MAX_RECEIPT_BYTES) throw receiptError();
    if (typeof process.getuid === "function" && before.uid !== process.getuid()) throw receiptError();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw receiptError();
    if (makePrivate) await handle.chmod(0o600);
    return bytes;
  } finally { await handle.close(); }
}

async function identicalDestination(filename, expectedHash) {
  try { return checksum(await readReceipt(filename, true)) === expectedHash; } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function copyReceipt(bytes, filename, directory) {
  const expectedHash = checksum(bytes);
  const existing = await identicalDestination(filename, expectedHash);
  if (existing === false) throw receiptError();
  if (existing === true) return false;
  const temporary = path.join(directory, `.receipt-import-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (checksum(await readReceipt(temporary)) !== expectedHash) throw receiptError();
    await directoryAt(directory, false, true);
    try {
      // A hard link publishes the already verified inode exclusively and
      // atomically. Interrupted staging never creates a partial final name.
      await fs.link(temporary, filename);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST" || !(await identicalDestination(filename, expectedHash))) throw error;
      return false;
    }
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function importReceipts({ sourceDirectory, directory }) {
  try {
    const source = await directoryAt(sourceDirectory);
    const runtime = await directoryAt(directory, true, true);
    const target = await directoryAt(path.join(runtime, "private-receipts"), true, true);
    const summary = { copied: 0, skipped: 0 };
    for (const name of (await fs.readdir(source)).sort()) {
      if (name.length > 150 || !receiptNamePattern.test(name)) throw receiptError();
      const bytes = await readReceipt(path.join(source, name));
      if (!validReceipt(bytes, name)) throw receiptError();
      const copied = await copyReceipt(bytes, path.join(target, name), target);
      summary[copied ? "copied" : "skipped"] += 1;
    }
    return summary;
  } catch { throw receiptError(); }
}

module.exports = { importReceipts };
