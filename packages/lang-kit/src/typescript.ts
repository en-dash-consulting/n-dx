/**
 * TypeScript / JavaScript language configuration.
 *
 * Values are extracted from the hardcoded constants that previously lived in
 * `inventory.ts`, `imports.ts`, `components.ts`, and `callgraph-findings.ts`.
 * This config is the **backward-compatible default** — when no language is
 * detected or when a project has `package.json`, SourceVision uses this config.
 *
 * @module lang-kit/typescript
 */

import type { LanguageConfig } from "./registry.js";

/**
 * Dependency, build-output and cache directories JS tooling writes. A PHP
 * site ships the same (a theme's `node_modules/`, `dist/`), so `phpConfig`
 * reuses this set.
 */
export const TYPESCRIPT_SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "__pycache__",
  ".react-router",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  ".output",
]);

/** Compiled and minified output; shared with `phpConfig` for the same reason. */
export const TYPESCRIPT_GENERATED_FILE_PATTERNS: readonly RegExp[] = [
  /\.d\.ts$/,
  /\.min\.js$/,
  /\.bundle\.js$/,
];

/**
 * Language config for TypeScript / JavaScript projects.
 *
 * `skipDirectories` and `configFilenames` match the current hardcoded values
 * in `inventory.ts` so that adopting the registry is a zero-diff change for
 * existing JS/TS projects.
 */
export const typescriptConfig: LanguageConfig = {
  id: "typescript",
  displayName: "TypeScript",

  extensions: new Set([
    ".ts", ".tsx", ".mts", ".cts",
    ".js", ".jsx", ".mjs", ".cjs",
  ]),

  parseableExtensions: new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ]),

  testFilePatterns: [
    /\.test\./,
    /\.spec\./,
    /__tests__\//,
    /(?:^|\/)tests?\//,
  ],

  configFilenames: new Set([
    // JS/TS package managers
    "package.json",
    "package-lock.json",
    // TypeScript / JavaScript config
    "tsconfig.json",
    "jsconfig.json",
    // Linters
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.ts",
    // Formatters
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.json",
    ".prettierrc.yml",
    "prettier.config.js",
    "prettier.config.mjs",
    "prettier.config.ts",
    // Editor / environment
    ".editorconfig",
    ".gitignore",
    ".gitattributes",
    ".npmrc",
    ".npmignore",
    ".nvmrc",
    ".node-version",
    ".tool-versions",
    ".env.example",
    // Transpilers
    "babel.config.js",
    "babel.config.json",
    "babel.config.mjs",
    "babel.config.cjs",
    ".babelrc",
    // Test runners
    "jest.config.js",
    "jest.config.ts",
    "jest.config.mjs",
    "vitest.config.ts",
    "vitest.config.js",
    "vitest.config.mjs",
    // Bundlers
    "webpack.config.js",
    "webpack.config.ts",
    "rollup.config.js",
    "rollup.config.mjs",
    "rollup.config.ts",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "esbuild.config.js",
    "esbuild.config.mjs",
    // CSS tooling
    "postcss.config.js",
    "postcss.config.mjs",
    "postcss.config.cjs",
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.mjs",
    // Frameworks
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "nuxt.config.ts",
    "nuxt.config.js",
    "svelte.config.js",
    "astro.config.mjs",
    "astro.config.ts",
    // Cross-language build / config files (kept for backward compatibility
    // with the universal CONFIG_FILENAMES set in inventory.ts)
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "Pipfile",
    "Gemfile",
    "Gemfile.lock",
    "Rakefile",
    "composer.json",
    "composer.lock",
    "Makefile",
    "GNUmakefile",
    "CMakeLists.txt",
    "Justfile",
  ]),

  skipDirectories: TYPESCRIPT_SKIP_DIRECTORIES,

  generatedFilePatterns: TYPESCRIPT_GENERATED_FILE_PATTERNS,

  entryPointPatterns: [
    /(?:^|\/)index\.[tj]sx?$/,
    /(?:^|\/)main\.[tj]sx?$/,
    /(?:^|\/)cli\.[tj]sx?$/,
    /(?:^|\/)public\.[tj]sx?$/,
    /(?:^|\/)mod\.[tj]sx?$/,
  ],

  moduleFile: "package.json",
};
