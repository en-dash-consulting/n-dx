/**
 * This package's name and asset locations: its grammar in `build/grammars`,
 * its queries in `queries/terraform`, both found from the package root on first use.
 *
 * @module lang-terraform/package-paths
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packPackage } from "@n-dx/lang-runtime";

/** `<package>` root. This module sits in `src/` or `dist/`. */
const packageRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), "..");

export const TERRAFORM_PACKAGE = packPackage("@n-dx/lang-terraform", packageRoot);
