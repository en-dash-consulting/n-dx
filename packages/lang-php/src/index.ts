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
export * from "./php-builtins.js";
export * from "./php-compat.js";
export * from "./php-legacy.js";
export * from "./php-version-sources.js";
export * from "./php-docroot.js";
export * from "./php-docroots.js";
export * from "./php-cron.js";
export * from "./php-entry-points.js";
export * from "./php-htaccess.js";
export * from "./php-imports.js";
export * from "./php-include-notices.js";
export * from "./php-includes.js";
export * from "./php-outbound.js";
export * from "./php-resolver.js";
export * from "./php-sql.js";
export * from "./php-symbols.js";
