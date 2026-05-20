import type { NextConfig } from "next";

const nextConfig = {
  agentRules: false,
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
} satisfies NextConfig;

export default nextConfig;
