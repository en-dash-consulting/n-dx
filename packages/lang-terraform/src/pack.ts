/**
 * The Terraform pack entry: what sourcevision loads from this package. It
 * produces `resources`, read from the Terraform model over the whole project.
 *
 * @module lang-terraform/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { TERRAFORM_PACKAGE } from "./package-paths.js";
import { readTerraformFacts } from "./terraform-facts.js";
import { terraformPack } from "./terraform-pack.js";

export const pack: LanguagePackEntry = createPackEntry({
  package: TERRAFORM_PACKAGE,
  pack: terraformPack,
  projectFacts: readTerraformFacts,
});
