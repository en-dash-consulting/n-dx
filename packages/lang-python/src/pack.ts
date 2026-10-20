/**
 * The Python pack entry: what sourcevision loads from this package.
 *
 * @module lang-python/pack
 */

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { createPackEntry } from "@n-dx/lang-runtime";
import { PYTHON_PACKAGE } from "./package-paths.js";
import { pythonProjectNotices } from "./python-notices.js";
import { pythonPack } from "./python-pack.js";
import { PYTHON_SYMBOL_RULES } from "./python-symbols.js";

export const pack: LanguagePackEntry = createPackEntry({
  package: PYTHON_PACKAGE,
  pack: pythonPack,
  symbolRules: PYTHON_SYMBOL_RULES,
  projectNotices: pythonProjectNotices,
});
