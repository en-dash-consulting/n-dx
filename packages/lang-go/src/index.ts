/**
 * `@n-dx/lang-go` — the package's one public entry.
 *
 * `pack` is the lang-kit pack entry sourcevision loads, and the only export
 * it reads. The tree-sitter pack, its resolver, symbol rules and the
 * embedded-SQL reader are exported for the corpus scripts and tests in the
 * n-dx workspace.
 */

export { pack } from "./pack.js";
export { GO_PACKAGE } from "./package-paths.js";
export * from "./go-pack.js";
export * from "./go-resolver.js";
export * from "./go-sql.js";
