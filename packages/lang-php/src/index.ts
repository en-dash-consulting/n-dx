/**
 * `@n-dx/lang-php` — the package's one public entry.
 *
 * `pack` is the lang-kit pack entry sourcevision loads, and the only export
 * it reads. The tree-sitter pack is exported for tests and corpus scripts in
 * the n-dx workspace.
 */

export { pack } from "./pack.js";
export { PHP_PACKAGE } from "./package-paths.js";
export * from "./php-pack.js";
export * from "./php-imports.js";
export * from "./php-symbols.js";
