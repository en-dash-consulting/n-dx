/**
 * `@n-dx/lang-java` — the package's one public entry.
 *
 * `pack` is the lang-kit pack entry sourcevision loads, and the only export
 * it reads. The tree-sitter pack, its resolver, symbol rules and the
 * embedded-SQL reader are exported for the corpus scripts and tests in the
 * n-dx workspace.
 */

export { pack } from "./pack.js";
export { JAVA_PACKAGE } from "./package-paths.js";
export * from "./java-pack.js";
export * from "./java-resolver.js";
export * from "./java-sql.js";
export * from "./spring-boot.js";
