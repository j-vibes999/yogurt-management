import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const buildId=process.env.YOGURT_BUILD_ID??randomUUID();
process.env.YOGURT_BUILD_ID=buildId;

const nextConfig: NextConfig = {
  // Middleware normally rewrites 127.0.0.1 redirects to localhost. Desktop storage
  // and its request capability must retain the same exact loopback origin.
  ...(process.env.DESKTOP_BUILD === "1" ? { output: "standalone" as const, skipMiddlewareUrlNormalize: true } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  generateBuildId: async()=>buildId,
  env: {NEXT_PUBLIC_BUILD_ID:buildId,NEXT_PUBLIC_METRICS_PROVENANCE:process.env.NEXT_PUBLIC_METRICS_PROVENANCE??"production"},
};

export default nextConfig;
