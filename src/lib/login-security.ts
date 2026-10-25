/** Failed logins allowed before an account is locked. */
export const LOCKOUT_THRESHOLD = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

/**
 * Lock the account after the 5th consecutive failure: 15 minutes, doubling with each further
 * failure up to 1 hour. A 4-digit PIN then takes months to guess instead of hours, while an
 * attacker can keep the real owner out for at most an hour at a time.
 */
export function lockoutUntil(failedCount: number, now = Date.now()): Date | null {
  if (!Number.isSafeInteger(failedCount) || failedCount < LOCKOUT_THRESHOLD) return null;
  const doublings = Math.min(failedCount - LOCKOUT_THRESHOLD, 8);
  return new Date(now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** doublings));
}

type UnknownEmail = { failedLoginCount: number; lockedUntil: number | null; touchedAt: number };
const unknownEmails = new Map<string, UnknownEmail>();
const UNKNOWN_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_UNKNOWN_EMAILS = 5000;

function liveUnknownEmail(email: string, now: number) {
  const entry = unknownEmails.get(email.trim().toLowerCase());
  return entry && now - entry.touchedAt <= UNKNOWN_EMAIL_TTL_MS ? entry : undefined;
}

/**
 * Lock state for an email that has no account. Real accounts lock in the database; this keeps the
 * same count in memory so a locked unknown email answers exactly like a locked real one.
 */
export function unknownEmailLockedUntil(email: string, now = Date.now()): Date | null {
  const lockedUntil = liveUnknownEmail(email, now)?.lockedUntil;
  return lockedUntil && lockedUntil > now ? new Date(lockedUntil) : null;
}

export function recordUnknownEmailFailure(email: string, now = Date.now()): Date | null {
  let entry = liveUnknownEmail(email, now);
  if (!entry) {
    if (unknownEmails.size >= MAX_UNKNOWN_EMAILS) {
      for (const [key, value] of unknownEmails) if (now - value.touchedAt > UNKNOWN_EMAIL_TTL_MS) unknownEmails.delete(key);
      const oldest = [...unknownEmails.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
      for (const [key] of oldest.slice(0, Math.max(0, unknownEmails.size - MAX_UNKNOWN_EMAILS + 1))) unknownEmails.delete(key);
    }
    entry = { failedLoginCount: 0, lockedUntil: null, touchedAt: now };
    unknownEmails.set(email.trim().toLowerCase(), entry);
  }
  entry.failedLoginCount += 1;
  entry.touchedAt = now;
  const lockedUntil = lockoutUntil(entry.failedLoginCount, now);
  entry.lockedUntil = lockedUntil?.getTime() ?? null;
  return lockedUntil;
}

const loginQueues = new Map<string, Promise<void>>();

/**
 * Runs login attempts for one email one at a time. Without this, many simultaneous guesses would
 * all pass the lock check before the first failure is saved, and the lockout would not hold.
 */
export async function oneAttemptAtATime<T>(email: string, attempt: () => Promise<T>): Promise<T> {
  const key = email.trim().toLowerCase();
  const previous = loginQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
  loginQueues.set(key, mine);
  await previous;
  try {
    return await attempt();
  } finally {
    release();
    if (loginQueues.get(key) === mine) loginQueues.delete(key);
  }
}

export function resetUnknownEmailsForTests() {
  unknownEmails.clear();
}

/**
 * Cloudflare overwrites CF-Connecting-IP with the visitor's real address, so it is the only
 * forwarding header a client cannot forge here. Requests without it come from this computer.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const value = headers.get("cf-connecting-ip")?.trim() ?? "";
  return value.length > 0 && value.length <= 45 && /^[0-9A-Fa-f:.]+$/.test(value) ? value : "local";
}
