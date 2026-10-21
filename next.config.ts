import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // web-tree-sitter loads its wasm at runtime, so keep it out of the bundle.
  serverExternalPackages: ["web-tree-sitter", "tree-sitter-wasms"],
};

export default nextConfig;
