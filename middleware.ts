import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySession, type UserRole } from "@/lib/auth-session";
import { rolesForApi, rolesForPage } from "@/lib/access-policy";

const HOST_PATTERN = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
// Limits framing, form targets, <base> and plugins. Script and style sources need a nonce-based
// policy that has to be checked in a real browser first, so they are not restricted here yet.
const CONTENT_SECURITY_POLICY = "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";

/**
 * The host the visitor used. Cloudflare routes by the Host header, so it cannot be forged from
 * outside; X-Forwarded-Host can, and is only trusted when a local proxy has rewritten Host.
 */
function requestHost(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  if (LOOPBACK_HOST.test(host) && HOST_PATTERN.test(forwarded)) return forwarded;
  return HOST_PATTERN.test(host) ? host : request.nextUrl.host;
}

function externalUrl(request: NextRequest, pathname: string) {
  const proto = request.headers.get("x-forwarded-proto") === "https" ? "https" : request.nextUrl.protocol.replace(":", "");
  return new URL(pathname, `${proto}://${requestHost(request)}`);
}

function secure<T extends NextResponse>(response: T, request: NextRequest) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  if (request.headers.get("x-forwarded-proto") === "https") response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}

function unsafeCrossSite(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== requestHost(request);
  } catch { return true; }
}

function toLogin(request: NextRequest, pathname: string) {
  const login = externalUrl(request, "/login");
  login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return secure(NextResponse.redirect(login), request);
}

const offlinePages = new Set(["/", "/stores", "/map", "/refills", "/driver", "/settlements", "/fridges", "/expenses", "/reports", "/notifications"]);

export async function middleware(request: NextRequest) {
  const legacyReceipt = request.nextUrl.pathname.startsWith("/uploads/receipts/");
  // Resolve legacy links to the protected API before any public-path bypass.
  const pathname = legacyReceipt ? request.nextUrl.pathname.replace(/^\/uploads\/receipts\//, "/api/receipts/") : request.nextUrl.pathname;
  if (pathname.startsWith("/api/") && unsafeCrossSite(request)) return secure(NextResponse.json({ error: "ຄຳຂໍຈາກເວັບໄຊອື່ນຖືກປິດກັ້ນ" }, { status: 403 }), request);
  if (pathname === "/login" || pathname === "/api/auth/login" || pathname === "/api/auth/logout" || pathname === "/api/session" || pathname === "/api/health" || pathname.startsWith("/_next/") || pathname === "/favicon.ico") return secure(NextResponse.next(), request);
  const secret = getSessionSecret();
  if (!secret) return secure(new NextResponse("SESSION_SECRET is not configured securely", { status: 503 }), request);
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (!session) {
    if (pathname.startsWith("/api/")) return secure(NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 }), request);
    return toLogin(request, pathname);
  }
  const expectedUser=request.headers.get("X-Operation-User");
  if(!["GET","HEAD","OPTIONS"].includes(request.method)&&expectedUser&&expectedUser!==session.userId)return secure(NextResponse.json({error:"ບັນຊີຜູ້ໃຊ້ປ່ຽນແປງ; ກະລຸນາໂຫຼດໜ້າຄືນ",retryable:true},{status:409}), request);
  const internalOrigin = process.env.INTERNAL_APP_ORIGIN ?? `http://127.0.0.1:${process.env.PORT || request.nextUrl.port || "3000"}`;
  let sessionCheck: Response;
  try {
    sessionCheck = await fetch(new URL("/api/session", internalOrigin), { headers: { cookie: `${SESSION_COOKIE}=${request.cookies.get(SESSION_COOKIE)?.value ?? ""}` }, cache: "no-store" });
  } catch {
    return secure(new NextResponse("ກວດສອບການເຂົ້າລະບົບບໍ່ໄດ້ຊົ່ວຄາວ; ກະລຸນາລອງໃໝ່ (Session verification is temporarily unavailable)", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }), request);
  }
  if (!sessionCheck.ok) {
    if (pathname.startsWith("/api/")) return secure(NextResponse.json({ error: "ກະລຸນາເຂົ້າລະບົບກ່ອນ" }, { status: 401 }), request);
    return toLogin(request, pathname);
  }
  const fresh = await sessionCheck.json().catch(() => null) as { role?: UserRole; source?: string } | null;
  if (!fresh?.role || !["database", "offline"].includes(fresh.source ?? "")) return secure(new NextResponse("ກວດສອບການເຂົ້າລະບົບບໍ່ໄດ້ຊົ່ວຄາວ; ກະລຸນາລອງໃໝ່ (Session verification is temporarily unavailable)", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }), request);
  const effectiveRole = fresh.role;
  if (!pathname.startsWith("/api/")) {
    const pageAllowed = rolesForPage(pathname);
    if (pageAllowed && !pageAllowed.includes(effectiveRole)) return secure(NextResponse.redirect(externalUrl(request, "/")), request);
    if (fresh?.source === "offline" && !offlinePages.has(pathname)) return secure(NextResponse.redirect(externalUrl(request, "/")), request);
  }
  if (pathname.startsWith("/api/")) {
    if (fresh.source === "offline") return secure(NextResponse.json({ error: "ຖານຂໍ້ມູນໃຊ້ງານບໍ່ໄດ້ຊົ່ວຄາວ; ກະລຸນາລອງໃໝ່ໃນພາຍຫຼັງ" }, { status: 503 }), request);
    const allowed = rolesForApi(pathname, request.method);
    if (allowed && !allowed.includes(effectiveRole)) return secure(NextResponse.json({ error: "ບັນຊີນີ້ບໍ່ມີສິດເຮັດລາຍການນີ້" }, { status: 403 }), request);
  }
  if (legacyReceipt) {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    return secure(NextResponse.rewrite(target), request);
  }
  return secure(NextResponse.next(), request);
}

// Everything except Next's static output and the public illustrations runs through the checks above.
// The old rule skipped any path ending in .png/.svg/..., which also skipped pages and APIs named that way.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon\\.ico|illustrations/).*)"] };
