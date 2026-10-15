/**
 * `@n-dx/lang-terraform` — the package's one public entry.
 *
 * `pack` is the lang-kit pack entry sourcevision loads, and the only export
 * it reads. The tree-sitter pack, its grammar path and the Terraform model
 * are exported for the corpus scripts and tests in the n-dx workspace.
 */

export { pack } from "./pack.js";
export { TERRAFORM_PACKAGE } from "./package-paths.js";
export * from "./terraform-pack.js";
export * from "./terraform-model.js";
export * from "./terraform-facts.js";
