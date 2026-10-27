/**
 * The Go pack entry: what sourcevision loads from this package.
 *
 * @module lang-go/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { GO_SYMBOL_RULES, goPack } from "./go-pack.js";
import { GO_PACKAGE } from "./package-paths.js";

export const pack: LanguagePackEntry = createPackEntry({ package: GO_PACKAGE, pack: goPack, symbolRules: GO_SYMBOL_RULES });
