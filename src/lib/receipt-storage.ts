import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeDataDirectory } from "./runtime-paths.ts";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const receiptNamePattern = /^receipt-[A-Za-z0-9-]+\.(?:jpg|jpeg|png|webp|pdf)$/;
const receiptTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;
type ReceiptType = keyof typeof receiptTypes;

export function isSafeReceiptName(name: string) {
  return name.length <= 150 && receiptNamePattern.test(name);
}

export function privateReceiptDirectory(rootDirectory = process.cwd()) {
  return path.join(runtimeDataDirectory(rootDirectory), "private-receipts");
}

function hasPngStructure(bytes: Buffer) {
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

function hasJpegStructure(bytes: Buffer) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let frameComponents = 0;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0x01) continue;
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length - 2) return false;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
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

function hasWebpImageChunks(bytes: Buffer, start: number, limit: number, insideFrame = false): boolean {
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
      // Animation frame data starts after its 16-byte rectangle/duration header.
      if (insideFrame || length <= 16 || !hasWebpImageChunks(bytes, payload + 16, end, true)) return false;
      hasImage = true;
    }
    offset = paddedEnd;
  }
  return hasImage;
}

export function validReceiptContent(bytes: Buffer, mimeType: string): mimeType is ReceiptType {
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) return false;
  if (mimeType === "image/jpeg") return hasJpegStructure(bytes);
  if (mimeType === "image/png") return hasPngStructure(bytes);
  if (mimeType === "image/webp") {
    if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return false;
    return hasWebpImageChunks(bytes, 12, bytes.length);
  }
  if (mimeType === "application/pdf") {
    const header = bytes.toString("ascii", 0, 8);
    const tail = bytes.toString("latin1", Math.max(0, bytes.length - 1024));
    return /^%PDF-(?:1\.[0-7]|2\.0)/.test(header) && /startxref\s+\d+\s+%%EOF\s*$/.test(tail);
  }
  return false;
}

export async function storeReceipt(bytes: Buffer, mimeType: string, rootDirectory = process.cwd()) {
  if (!validReceiptContent(bytes, mimeType)) throw new Error("INVALID_RECEIPT");
  const name = `receipt-${randomUUID()}.${receiptTypes[mimeType]}`;
  const directory = privateReceiptDirectory(rootDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 });
  return { name, url: `/api/receipts/${name}` };
}

export async function openReceipt(name: string, rootDirectory = process.cwd()) {
  if (!isSafeReceiptName(name)) return null;
  const extension = name.slice(name.lastIndexOf(".") + 1);
  const mimeType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  // Existing expense URLs keep working during the migration out of public storage.
  const directories = [privateReceiptDirectory(rootDirectory), path.join(rootDirectory, "public", "uploads", "receipts")];
  for (const directory of directories) {
    let handle;
    try {
      handle = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size === 0 || info.size > MAX_RECEIPT_BYTES) {
        await handle.close();
        return null;
      }
      return { handle, size: info.size, mimeType };
    } catch (error) {
      await handle?.close();
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      if (code === "ELOOP") return null;
      throw error;
    }
  }
  return null;
}
