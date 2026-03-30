/**
 * Go language configuration.
 *
 * Defines extensions, skip directories, test/generated file patterns,
 * config filenames, and entry points specific to Go projects.
 *
 * @module sourcevision/language/go
 */

import type { LanguageConfig } from "./registry.js";

/**
 * Language config for Go projects.
 *
 * Key Go-specific behaviors:
 * - `vendor/` is in `skipDirectories` (vendored dependencies)
 * - `_test.go` suffix identifies test files
 * - `_gen.go`, `.pb.go`, `wire_gen.go` are generated file patterns
 * - `go.mod` is the module manifest
 */
export const goConfig: LanguageConfig = {
  id: "go",
  displayName: "Go",

  extensions: new Set([".go"]),

  parseableExtensions: new Set([".go"]),

  testFilePatterns: [
    /_test\.go$/,
  ],

  configFilenames: new Set([
    "go.mod",
    "go.sum",
    ".golangci.yml",
    ".golangci.yaml",
    ".golangci.json",
    ".golangci.toml",
    "Makefile",
    "GNUmakefile",
  ]),

  skipDirectories: new Set([
    "vendor",
    "dist",
    "build",
    ".cache",
    "coverage",
  ]),

  generatedFilePatterns: [
    /_gen\.go$/,
    /\.pb\.go$/,
    /wire_gen\.go$/,
    /mock_[^/]*\.go$/,
    /_mock\.go$/,
    /\.gen\.go$/,
    /generated\.go$/,
    /_string\.go$/,
  ],

  entryPointPatterns: [
    /(?:^|\/)main\.go$/,
    /(?:^|\/)cmd\/[^/]+\/main\.go$/,
  ],

  moduleFile: "go.mod",
};
