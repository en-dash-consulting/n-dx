/**
 * Terraform language pack, structure only: the pinned tree-sitter-hcl grammar
 * and no queries or fact kinds yet. The Terraform model and its resources
 * facts come with PR 13. Detection, the inventory and the Terraform file set
 * stay in `@n-dx/lang-kit` and sourcevision.
 *
 * @module lang-terraform/terraform-pack
 */

import { join } from "node:path";
import { terraformConfig } from "@n-dx/lang-kit";
import type { LanguagePack } from "@n-dx/lang-runtime";
import { TERRAFORM_PACKAGE } from "./package-paths.js";

/** Keep in step with `packages/lang-runtime/scripts/build-grammars.mjs`. */
const GRAMMAR_VERSION = "1.2.0";

export const terraformPack: LanguagePack = {
  id: terraformConfig.id,
  config: terraformConfig,
  grammar: { name: "tree-sitter-hcl", version: GRAMMAR_VERSION },
  queries: [],
  produces: [],
  provenance: {},
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-hcl.wasm`. */
export const terraformGrammarPath = (): string => join(TERRAFORM_PACKAGE.grammarDir(), `${terraformPack.grammar.name}.wasm`);
