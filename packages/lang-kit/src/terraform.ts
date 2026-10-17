/**
 * Terraform language configuration.
 *
 * Inventory roles only. Structure comes from the Terraform pack
 * (`@n-dx/lang-terraform`) as `resources` facts.
 *
 * @module lang-kit/terraform
 */

import { extname } from "node:path";
import type { LanguageConfig } from "./registry.js";

/**
 * Language config for Terraform and Terragrunt repositories.
 *
 * - `.terraform/` holds downloaded providers and modules; it is skipped.
 * - `.tfvars` and `terragrunt.hcl` are configuration. `*.tftest.hcl` files and
 *   Terraform files under a `tests/` or `test/` directory are tests; the
 *   inventory applies these patterns to Terraform files only, and only when
 *   Terraform is the primary language (`classifyRole` in sourcevision).
 * - No extension is parseable: there is no import graph, so Terraform files
 *   take no part in import or zone analysis.
 * - Detection never makes Terraform the primary language unless no other
 *   marker matches (see `detect.ts`).
 */
export const terraformConfig: LanguageConfig = {
  id: "terraform",
  displayName: "Terraform",

  extensions: new Set([".tf", ".tfvars"]),

  parseableExtensions: new Set(),

  // The directory pattern needs a `/`, so `isTerraformFile`, which tests bare names, never matches it.
  testFilePatterns: [/\.tftest\.hcl$/, /(?:^|\/)tests?\//],

  configFilenames: new Set(["terragrunt.hcl"]),

  configFilePatterns: [/\.tfvars$/],

  skipDirectories: new Set([".terraform"]),

  generatedFilePatterns: [],

  entryPointPatterns: [],
};

/**
 * The one definition of "is this file Terraform", built from `terraformConfig`.
 * Detection (`detect.ts`) and the inventory (`inventory.ts`) both call it, so
 * they cannot disagree about which names are Terraform. Takes a file name, not
 * a path. The extension is matched case-insensitively; names and patterns as
 * written in the config.
 */
export function isTerraformFile(name: string): boolean {
  return (
    terraformConfig.extensions.has(extname(name).toLowerCase()) ||
    terraformConfig.configFilenames.has(name) ||
    (terraformConfig.configFilePatterns ?? []).some((p) => p.test(name)) ||
    terraformConfig.testFilePatterns.some((p) => p.test(name))
  );
}
