import type { NextConfig } from "next";

const nextConfig = {
  agentRules: false,
  output: "export",
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
} satisfies NextConfig;

export default nextConfig;
