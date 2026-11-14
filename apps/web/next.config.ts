import type { NextConfig } from "next";

// GitHub Pages はリポジトリ名のサブパスで配信される。CI が NEXT_PUBLIC_BASE_PATH を渡す。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const config: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  transpilePackages: ["@cabinet/url"],
};

export default config;
