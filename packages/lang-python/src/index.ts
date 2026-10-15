/**
 * `@n-dx/lang-python` — the package's one public entry.
 *
 * `pack` is the lang-kit pack entry sourcevision loads, and the only export
 * it reads. The tree-sitter pack, its resolver, symbol rules and notices are
 * exported for the corpus scripts and tests in the n-dx workspace.
 */

export { pack } from "./pack.js";
export { PYTHON_PACKAGE } from "./package-paths.js";
export * from "./python-pack.js";
export * from "./python-imports.js";
export * from "./python-symbols.js";
export * from "./python-notices.js";
