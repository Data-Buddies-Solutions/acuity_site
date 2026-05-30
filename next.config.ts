import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    qualities: [75, 95],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        hostname: "*.public.blob.vercel-storage.com",
        protocol: "https",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/platform",
        destination: "/#offers",
        permanent: true,
      },
      {
        source: "/results",
        destination: "/#results",
        permanent: true,
      },
      {
        source: "/insights/hidden-cost-of-missed-calls-ophthalmology",
        destination: "/insights/the-cost-of-a-missed-call-in-ophthalmology",
        permanent: true,
      },
      {
        source: "/blog",
        destination: "/insights",
        permanent: true,
      },
      {
        source: "/blog/:slug",
        destination: "/insights",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
