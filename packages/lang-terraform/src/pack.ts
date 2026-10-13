/**
 * The Terraform pack entry: what sourcevision loads from this package. It
 * produces no fact kinds yet.
 *
 * @module lang-terraform/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { TERRAFORM_PACKAGE } from "./package-paths.js";
import { terraformPack } from "./terraform-pack.js";

export const pack: LanguagePackEntry = createPackEntry({ package: TERRAFORM_PACKAGE, pack: terraformPack });
