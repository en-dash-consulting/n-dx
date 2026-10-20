/**
 * Terraform language pack: the pinned tree-sitter-hcl grammar and the
 * structure queries under `queries/terraform/`. The captures are read into
 * the Terraform model (`terraform-model.ts`), and the model into lang-kit
 * `resources` facts (`terraform-facts.ts`). Detection, the inventory and the
 * Terraform file set stay in `@n-dx/lang-kit` and sourcevision.
 *
 * @module lang-terraform/terraform-pack
 */

import { join } from "node:path";
import { terraformConfig } from "@n-dx/lang-kit";
import type { LanguagePack, RuleProvenance } from "@n-dx/lang-runtime";
import { TERRAFORM_PACKAGE } from "./package-paths.js";

/** Keep in step with `packages/lang-runtime/scripts/build-grammars.mjs`; update `verifiedOn` when re-checking. */
const GRAMMAR_VERSION = "1.2.0";

/**
 * One query file per construct, read by `terraform-model.ts`:
 *
 * - `resources`: resource and data blocks (type, name, span)
 * - `modules`: module calls (name, source, version)
 * - `providers`: provider configurations (name, alias)
 * - `terraform`: the settings block, `required_providers` and the backend
 * - `declarations`: variables, outputs and locals
 * - `arguments`: every argument and nested block inside a top-level block
 * - `references`: reference expressions (`type.name.attr`, `module.x.y`, `var.x`, `local.x`)
 */
export const TERRAFORM_QUERY_NAMES = [
  "resources",
  "modules",
  "providers",
  "terraform",
  "declarations",
  "arguments",
  "references",
] as const;

export type TerraformQueryName = (typeof TERRAFORM_QUERY_NAMES)[number];

const VERIFIED: RuleProvenance = {
  verifiedAgainst: [`tree-sitter-hcl@${GRAMMAR_VERSION}`, "Terraform 1.x configuration language"],
  verifiedOn: "2026-10-15",
  source: `https://github.com/tree-sitter-grammars/tree-sitter-hcl/blob/v${GRAMMAR_VERSION}/src/node-types.json`,
};

export const terraformPack: LanguagePack = {
  id: terraformConfig.id,
  config: terraformConfig,
  grammar: { name: "tree-sitter-hcl", version: GRAMMAR_VERSION },
  // A getter, so the paths are computed on first use rather than at import.
  get queries() {
    return TERRAFORM_QUERY_NAMES.map((name) => ({ name, path: join(TERRAFORM_PACKAGE.queryDir("terraform"), `${name}.scm`) }));
  },
  // Read over the whole project (module calls, references); see `terraform-facts.ts`.
  produces: ["resources"],
  provenance: Object.fromEntries(TERRAFORM_QUERY_NAMES.map((name) => [name, VERIFIED])),
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-hcl.wasm`. */
export const terraformGrammarPath = (): string => join(TERRAFORM_PACKAGE.grammarDir(), `${terraformPack.grammar.name}.wasm`);
