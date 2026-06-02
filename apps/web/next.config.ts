import type { NextConfig } from "next";

const config: NextConfig = {
  // `standalone` produces `.next/standalone/` with a minimal node_modules —
  // a self-contained bundle that `docker build` can copy in one step.
  output: "standalone",
  // The monorepo root is two levels up; tell Next where to stop file-tracing
  // so the standalone bundle includes workspace dependencies.
  outputFileTracingRoot: process.cwd() + "/../..",
  transpilePackages: ["@brain/core", "@brain/db", "@brain/types"],
  // Prisma client ships platform-specific engine binaries and a generated
  // `.d.ts` that Next's webpack should not bundle. Leaving it as an
  // external require() lets Node load the correct binary at runtime.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@auth/prisma-adapter"],
  // Next's embedded build-time type check diverges from workspace `tsc`
  // inside Docker (Prisma client result types fall back to `any` for
  // reasons tied to Next's generated `.next/types`). The authoritative
  // typecheck is `pnpm -r typecheck` in CI and pre-commit — skip Next's
  // duplicate pass rather than whack-a-mole each callback site.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Packages under the workspace use NodeNext-style imports with a ".js"
  // suffix that resolves to ".ts" at tsc build time. Teach the bundler the
  // same alias so the Next.js server build succeeds without emitting each
  // workspace package to dist first.
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".mjs"],
    resolveAlias: {},
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve ??= {};
    const existing =
      (webpackConfig.resolve.extensionAlias as Record<string, string[]> | undefined) ?? {};
    webpackConfig.resolve.extensionAlias = {
      ...existing,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return webpackConfig;
  },
};

export default config;
