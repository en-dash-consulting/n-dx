/**
 * Terraform language configuration.
 *
 * Inventory roles only. Structure comes from the HCL grammar's queries and
 * stays in memory; nothing here is written to `infrastructure.json`.
 *
 * @module sourcevision/language/terraform
 */

import { extname } from "node:path";
import type { LanguageConfig } from "./registry.js";

/**
 * Language config for Terraform and Terragrunt repositories.
 *
 * - `.terraform/` holds downloaded providers and modules; it is skipped.
 * - `.tfvars` and `terragrunt.hcl` are configuration, `*.tftest.hcl` are tests.
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

  testFilePatterns: [/\.tftest\.hcl$/],

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
