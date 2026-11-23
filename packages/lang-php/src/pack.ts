/**
 * The PHP pack entry: what sourcevision loads from this package.
 *
 * @module lang-php/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { rewriteLegacySyntax } from "./php-legacy-syntax.js";
import { phpPack } from "./php-pack.js";
import { PHP_SYMBOL_RULES } from "./php-symbols.js";

export const pack: LanguagePackEntry = createPackEntry({
  package: PHP_PACKAGE,
  pack: phpPack,
  symbolRules: PHP_SYMBOL_RULES,
  // PHP 5's `$s{0}` offsets, which the PHP 8 grammar cannot parse, are rewritten to `$s[0]` and parsed again.
  legacySyntax: rewriteLegacySyntax,
});
