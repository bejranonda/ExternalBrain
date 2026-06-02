// Standalone ESLint flat config for @brain/web after Next.js 16 removed
// the bundled `next lint` subcommand (issue #41).
//
// Scope is intentionally narrow: lint TypeScript + JS in src trees, ignore
// generated/build/test artefacts. We start with `@eslint/js` recommended +
// `typescript-eslint` recommended, which catches real bugs (unused vars,
// no-undef, prefer-const, etc.) without being noisy. Next-specific rules
// (eslint-plugin-next core-web-vitals) can be layered in a follow-up — the
// file-loading lint is the high-value piece this issue asks for.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "*.config.*",
      "next-env.d.ts",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        React: "readonly",
        JSX: "readonly",
      },
    },
    rules: {
      // Next.js / React patterns that would otherwise fire spuriously.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
