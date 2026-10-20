/**
 * `@n-dx/lang-sql` — the package's one public entry.
 *
 * `pack` is the lang-kit pack entry sourcevision loads, and the only export
 * it reads. The tree-sitter pack, its symbol rules and the schema reader are
 * exported for the corpus scripts and tests in the n-dx workspace.
 */

export { pack } from "./pack.js";
export { SQL_PACKAGE } from "./package-paths.js";
export * from "./sql-facts.js";
export * from "./sql-pack.js";
export * from "./sql-schema.js";
