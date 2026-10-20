/**
 * The Java pack entry: what sourcevision loads from this package.
 *
 * @module lang-java/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { JAVA_SYMBOL_RULES, javaPack } from "./java-pack.js";
import { JAVA_PACKAGE } from "./package-paths.js";

export const pack: LanguagePackEntry = createPackEntry({ package: JAVA_PACKAGE, pack: javaPack, symbolRules: JAVA_SYMBOL_RULES });
