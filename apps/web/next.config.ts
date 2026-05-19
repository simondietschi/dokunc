import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";

// Monorepo: Root-.env laden, damit web dieselben Variablen wie collab/db nutzt.
loadEnv({ path: new URL("../../.env", import.meta.url).pathname });

const nextConfig: NextConfig = {
  transpilePackages: ["@dokunc/db", "@dokunc/editor"],
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
