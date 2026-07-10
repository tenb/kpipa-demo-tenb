import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  webpack: (config, { dev }) => {
    if (dev) {
      // data/(작품 저장소)·캡처 산출물 변경으로 인한 불필요한 리빌드 방지
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/data/**",
          "**/.playwright-mcp/**",
          "**/*.png",
          "**/*.log",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
