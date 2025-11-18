import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel-friendly configuration
  experimental: {
    turbo: {
      root: __dirname,
    },
  },
};

export default nextConfig;
