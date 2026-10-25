import { NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, verifySession, type UserRole } from "@/lib/auth-session";
import { rolesForApi, rolesForPage } from "@/lib/access-policy";

function externalUrl(request: NextRequest, pathname: string) {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return new URL(pathname, `${proto}://${host}`);
}

function secure<T extends NextResponse>(response: T) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function unsafeCrossSite(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
    return new URL(origin).host !== expectedHost;
  } catch { return true; }
}

const offlinePages = new Set(["/", "/stores", "/map", "/refills", "/driver", "/settlements", "/fridges", "/expenses", "/reports", "/notifications"]);

export async function middleware(request: NextRequest) {
  const legacyReceipt = request.nextUrl.pathname.startsWith("/uploads/receipts/");
  // Resolve legacy links to the protected API before any public-path bypass.
  const pathname = legacyReceipt ? request.nextUrl.pathname.replace(/^\/uploads\/receipts\//, "/api/receipts/") : request.nextUrl.pathname;
  if (pathname.startsWith("/api/") && unsafeCrossSite(request)) return secure(NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 }));
  if (pathname === "/login" || pathname === "/api/auth/login" || pathname === "/api/auth/logout" || pathname === "/api/session" || pathname === "/api/health" || pathname.startsWith("/_next/") || pathname === "/favicon.ico") return secure(NextResponse.next());
  const secret = getSessionSecret();
  if (!secret) return secure(new NextResponse("SESSION_SECRET is not configured securely", { status: 503 }));
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (!session) {
    if (pathname.startsWith("/api/")) return secure(NextResponse.json({ error: "Authentication required" }, { status: 401 }));
    const login = externalUrl(request, "/login"); login.searchParams.set("next", pathname); return secure(NextResponse.redirect(login));
  }
  const expectedUser=request.headers.get("X-Operation-User");
  if(!["GET","HEAD","OPTIONS"].includes(request.method)&&expectedUser&&expectedUser!==session.userId)return secure(NextResponse.json({error:"ບັນຊີຜູ້ໃຊ້ປ່ຽນແປງ; ກະລຸນາໂຫຼດໜ້າຄືນ",retryable:true},{status:409}));
  const internalOrigin = process.env.INTERNAL_APP_ORIGIN ?? `http://127.0.0.1:${process.env.PORT || request.nextUrl.port || "3000"}`;
  let sessionCheck: Response;
  try {
    sessionCheck = await fetch(new URL("/api/session", internalOrigin), { headers: { cookie: `${SESSION_COOKIE}=${request.cookies.get(SESSION_COOKIE)?.value ?? ""}` }, cache: "no-store" });
  } catch {
    return secure(new NextResponse("Session verification is temporarily unavailable", { status: 503 }));
  }
  if (!sessionCheck.ok) {
    if (pathname.startsWith("/api/")) return secure(NextResponse.json({ error: "Authentication required" }, { status: 401 }));
    const login = externalUrl(request, "/login"); login.searchParams.set("next", pathname); return secure(NextResponse.redirect(login));
  }
  const fresh = await sessionCheck.json().catch(() => null) as { role?: UserRole; source?: string } | null;
  if (!fresh?.role || !["database", "offline"].includes(fresh.source ?? "")) return secure(new NextResponse("Session verification is temporarily unavailable", { status: 503 }));
  const effectiveRole = fresh.role;
  if (!pathname.startsWith("/api/")) {
    const pageAllowed = rolesForPage(pathname);
    if (pageAllowed && !pageAllowed.includes(effectiveRole)) return secure(NextResponse.redirect(externalUrl(request, "/")));
    if (fresh?.source === "offline" && !offlinePages.has(pathname)) return secure(NextResponse.redirect(externalUrl(request, "/")));
  }
  if (pathname.startsWith("/api/")) {
    if (fresh.source === "offline") return secure(NextResponse.json({ error: "Database is temporarily unavailable" }, { status: 503 }));
    const allowed = rolesForApi(pathname, request.method);
    if (allowed && !allowed.includes(effectiveRole)) return secure(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
  }
  if (legacyReceipt) {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    return secure(NextResponse.rewrite(target));
  }
  return secure(NextResponse.next());
}

export const config = { matcher: ["/uploads/receipts/:path*", "/api/receipts/:path*", "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"] };
