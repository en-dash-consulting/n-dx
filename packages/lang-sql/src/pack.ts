/**
 * The SQL pack entry: what sourcevision loads from this package.
 *
 * @module lang-sql/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { SQL_SYMBOL_RULES } from "./sql-facts.js";
import { sqlPack } from "./sql-pack.js";
import { SQL_PACKAGE } from "./package-paths.js";

export const pack: LanguagePackEntry = createPackEntry({ package: SQL_PACKAGE, pack: sqlPack, symbolRules: SQL_SYMBOL_RULES });
