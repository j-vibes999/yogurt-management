export type UserRole = "admin" | "production" | "driver";

export type SessionPayload = {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  credentialTag: string;
  exp: number;
};

export const SESSION_COOKIE = "yogurt_session";
const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function credentialBody(userId: string, passwordHash: string) {
  return encoder.encode(JSON.stringify(["yogurt-session-credentials-v1", userId, passwordHash]));
}

// Keep the password hash out of the cookie while binding the session to its current value.
export async function createCredentialTag(userId: string, passwordHash: string, secret: string) {
  const tag = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), credentialBody(userId, passwordHash)));
  return base64UrlEncode(tag);
}

export async function verifySessionCredentials(payload: SessionPayload, passwordHash: string, secret: string) {
  try {
    return await crypto.subtle.verify("HMAC", await signingKey(secret), base64UrlDecode(payload.credentialTag), credentialBody(payload.userId, passwordHash));
  } catch {
    return false;
  }
}

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export async function signSession(payload: SessionPayload, secret: string) {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(body)));
  return `${body}.${base64UrlEncode(signature)}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), base64UrlDecode(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    if (!payload || typeof payload !== "object" || typeof payload.userId !== "string" || !payload.userId ||
      typeof payload.email !== "string" || typeof payload.fullName !== "string" ||
      !["admin", "production", "driver"].includes(payload.role) ||
      typeof payload.credentialTag !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.credentialTag) ||
      !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
