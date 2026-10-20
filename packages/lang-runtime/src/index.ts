/**
 * `@n-dx/lang-runtime` — the package's one public entry.
 *
 * Every module is re-exported whole. Two modules exporting the same name is a
 * compile error here (TS2308); resolve it by renaming at this barrel, not by
 * changing the module.
 */

// Pack contract and grammar availability
export * from "./pack.js";

// Parsing and query running
export * from "./runner.js";

// Captures to lang-kit facts
export * from "./pack-calls.js";
export * from "./pack-facts.js";

// The pack entry a tree-sitter pack package exports, and where its assets live
export * from "./pack-package.js";
export * from "./pack-entry.js";

// Test helpers for packs: the grammar gate and the golden harness
export * from "./testing/grammar.js";
export * from "./testing/pack-golden.js";
