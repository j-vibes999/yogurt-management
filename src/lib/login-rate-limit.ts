type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_BUCKETS = 5000;

function prune(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, Math.ceil(MAX_BUCKETS * 0.1));
    for (const [key] of oldest) buckets.delete(key);
  }
}

export function loginIpRateKey(ip: string) {
  return `ip:${(ip || "unknown").trim().toLowerCase()}`;
}

export function loginRateKey(ip: string, email?: string) {
  return `account:${ip || "unknown"}:${(email || "*").trim().toLowerCase()}`;
}

export function checkLoginRateLimit(key: string, now = Date.now()) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return { allowed: true, retryAfter: 0 };
  if (bucket.count < MAX_ATTEMPTS) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

export function recordLoginFailure(key: string, now = Date.now()) {
  prune(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else existing.count += 1;
}

export function recordLoginSuccess(key: string) {
  buckets.delete(key);
}

export function resetLoginRateLimitForTests() {
  buckets.clear();
}
