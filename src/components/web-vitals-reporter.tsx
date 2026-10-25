"use client";
import { useReportWebVitals } from "next/web-vitals";
import { useCallback, useRef } from "react";

const publicPaths = new Set(["/", "/login", "/stores", "/stores/new", "/expenses", "/expenses/new", "/refills", "/refills/new", "/driver", "/settlements", "/inventory", "/inventory/adjust", "/inventory/receive", "/production", "/fridges", "/map", "/reports", "/notifications", "/operations", "/audit-log"]);
function metricPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  if (publicPaths.has(pathname)) return pathname;
  if (/^\/stores\/[^/]+(?:\/edit)?$/.test(pathname)) return pathname.endsWith("/edit") ? "/stores/[id]/edit" : "/stores/[id]";
  if (/^\/expenses\/[^/]+\/edit$/.test(pathname)) return "/expenses/[id]/edit";
  if (/^\/driver\/restock\/[^/]+$/.test(pathname)) return "/driver/restock/[storeId]";
  return "/other";
}

export function WebVitalsReporter() {
  const context = useRef<{ path: string; navigationId: string } | null>(null);
  if (!context.current && typeof window !== "undefined") {
    context.current = { path: metricPath(location.pathname), navigationId: `${performance.timeOrigin}` };
  }
  const report = useCallback<Parameters<typeof useReportWebVitals>[0]>((metric) => {
    try {
      const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
      const width = window.innerWidth;
      const payload = JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        delta: metric.delta,
        id: metric.id,
        navigationType: metric.navigationType,
        path: context.current?.path ?? "/other",
        navigationId: context.current?.navigationId,
        buildId: process.env.NEXT_PUBLIC_BUILD_ID,
        provenance: process.env.NODE_ENV === "development" ? "development" : process.env.NEXT_PUBLIC_METRICS_PROVENANCE === "synthetic" ? "synthetic" : "field",
        ts: new Date().toISOString(),
        viewport: width < 600 ? "mobile" : width < 1024 ? "tablet" : "desktop",
        connection: connection?.effectiveType,
        saveData: connection?.saveData,
      });
      const sent = navigator.sendBeacon?.("/api/metrics/web-vitals", payload);
      if (!sent) fetch("/api/metrics/web-vitals", { method: "POST", body: payload, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => null);
    } catch {}
  }, []);
  useReportWebVitals(report);
  return null;
}
