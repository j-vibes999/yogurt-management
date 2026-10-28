import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type BackupMetadata = {
  ok?: boolean;
  sourceFingerprint?: string | null;
  scope?: string;
  file?: string;
  sha256?: string;
  createdAt?: string;
  attemptedAt?: string;
  verifiedAt?: string;
  bytes?: number;
  receipts?: string | null;
};

function databaseUrlWithoutOverrides(databaseUrl: string) {
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("Invalid PostgreSQL database URL"); }
  const overrides = new Set(["host", "hostaddr", "port", "dbname", "user", "password", "service", "servicefile"]);
  if ([...url.searchParams.keys()].some((key) => overrides.has(key.toLowerCase()))) throw new Error("Database target override options are not supported");
  return url;
}

/** Password rotation and transport options do not change the identity of the data. */
export function databaseFingerprint(databaseUrl: string) {
  const url = databaseUrlWithoutOverrides(databaseUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("Expected a PostgreSQL database URL");
  const identity = [url.hostname.toLowerCase(), url.port || "5432", decodeURIComponent(url.username), decodeURIComponent(url.pathname), url.searchParams.get("schema") || "public"];
  return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

export function evaluateBackupReadiness(databaseUrl: string, backup: BackupMetadata | null, attempt: BackupMetadata | null, restore: BackupMetadata | null, now = Date.now()) {
  const reasons: string[] = [];
  let fingerprint: string | null = null;
  try { fingerprint = databaseFingerprint(databaseUrl); } catch { reasons.push("invalid-target"); }
  if (!backup?.ok || !backup.sha256 || !backup.file || backup.scope !== "public") reasons.push("missing-backup");
  if (!fingerprint || backup?.sourceFingerprint !== fingerprint) reasons.push("wrong-target");
  const created = Date.parse(backup?.createdAt || "");
  const ageHours = Number.isFinite(created) && created <= now + 60_000 ? Math.max(0, (now - created) / 3_600_000) : null;
  if (ageHours === null) reasons.push("invalid-timestamp");
  else if (ageHours > 36) reasons.push("stale");
  if (!attempt || attempt.sourceFingerprint !== fingerprint) reasons.push("attempt-unverified");
  else if (!attempt.ok) reasons.push("latest-attempt-failed");
  const verified = Date.parse(restore?.verifiedAt || "");
  const restoreOk = Boolean(restore?.ok && fingerprint && restore.sourceFingerprint === fingerprint && restore.sha256 === backup?.sha256 && restore.scope === "public" && Number.isFinite(verified) && verified >= created && verified <= now + 60_000);
  if (!restoreOk) reasons.push("restore-unverified");
  return { ok: reasons.length === 0, ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10, restoreVerified: restoreOk, reasons };
}

export function assertLocalScratchDatabase(databaseUrl: string) {
  const url = databaseUrlWithoutOverrides(databaseUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^yogurt_(?:e2e|restore_verify)_/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error("Refusing writes outside a local yogurt scratch database");
  return url;
}

/** A corrupt or absent state file provides no readiness evidence. */
export async function loadBackupReadiness(root: string, databaseUrl: string, now = Date.now()) {
  const directory = path.join(root, ".yogurt", "backups");
  async function read(name: string): Promise<BackupMetadata | null> {
    try {
      const data: unknown = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data as BackupMetadata : null;
    } catch { return null; }
  }
  const [backup, attempt, restore] = await Promise.all([read("latest.json"), read("latest-attempt.json"), read("last-restore-verification.json")]);
  const readiness = evaluateBackupReadiness(databaseUrl, backup, attempt, restore, now);
  const safeName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !value.includes("\0") && path.basename(value) === value;
  async function artifact(name: unknown) {
    if (!safeName(name)) return null;
    try { const info = await fs.lstat(path.join(directory, name)); return info.isFile() && !info.isSymbolicLink() ? info : null; }
    catch { return null; }
  }
  const dump = await artifact(backup?.file);
  if (!dump) readiness.reasons.push("backup-artifact-missing");
  else if (!Number.isSafeInteger(backup?.bytes) || !backup?.bytes || dump.size !== backup.bytes) readiness.reasons.push("backup-size-mismatch");
  if (backup?.receipts != null && !(await artifact(backup.receipts))) readiness.reasons.push("receipt-artifact-missing");
  if (readiness.reasons.length) return { ...readiness, ok: false, restoreVerified: false };
  return readiness;
}
