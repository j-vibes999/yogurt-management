import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const buildId=process.env.YOGURT_BUILD_ID??randomUUID();
process.env.YOGURT_BUILD_ID=buildId;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  generateBuildId: async()=>buildId,
  env: {NEXT_PUBLIC_BUILD_ID:buildId,NEXT_PUBLIC_METRICS_PROVENANCE:process.env.NEXT_PUBLIC_METRICS_PROVENANCE??"production"},
};

export default nextConfig;
