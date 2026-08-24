import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    typedEnv: false,
  },
};

export default nextConfig;
