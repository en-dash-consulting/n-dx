/**
 * The PHP pack entry: what sourcevision loads from this package.
 *
 * @module lang-php/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { phpPack } from "./php-pack.js";

export const pack: LanguagePackEntry = createPackEntry({
  package: PHP_PACKAGE,
  pack: phpPack,
});
