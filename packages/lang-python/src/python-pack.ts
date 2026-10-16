/**
 * Python language pack: the pinned tree-sitter grammar, the structure
 * queries under `queries/python/`, the resolver that reports imports as
 * written (`python-imports.ts`) and the symbol rules (`python-symbols.ts`).
 * Without this pack, Python files get inventory only: there is no other
 * Python parser.
 *
 * @module lang-python/python-pack
 */

import { join } from "node:path";
import { pythonConfig } from "@n-dx/lang-kit";
import type { LanguagePack, RuleProvenance } from "@n-dx/lang-runtime";
import { django } from "./django.js";
import { fastapi } from "./fastapi.js";
import { flask } from "./flask.js";
import { PYTHON_PACKAGE } from "./package-paths.js";
import { pythonResolver } from "./python-resolver.js";
import { PYTHON_STDLIB_PROVENANCE } from "./python-stdlib.js";

const QUERY_NAMES = ["imports", "guards", "definitions", "variables", "calls"] as const;

/** Query files ship in `queries/python`; see `package-paths.ts`. */
const queryPath = (file: string): string => join(PYTHON_PACKAGE.queryDir("python"), file);

/**
 * Grammar release the queries were written and checked against. Keep in step
 * with `packages/lang-runtime/scripts/build-grammars.mjs`; update `verifiedOn` when re-checking.
 * It does not parse PEP 696 type parameter defaults (`class C[T = int]`, new
 * in 3.13): such a file parses with ERROR nodes, and its facts outside the
 * error are still read.
 */
const GRAMMAR_VERSION = "0.25.0";

const VERIFIED: RuleProvenance = {
  verifiedAgainst: [`tree-sitter-python@${GRAMMAR_VERSION}`, "Python 3.13"],
  verifiedOn: "2026-10-15",
  source: `https://github.com/tree-sitter/tree-sitter-python/blob/v${GRAMMAR_VERSION}/src/node-types.json`,
};

export const pythonPack: LanguagePack = {
  id: pythonConfig.id,
  config: pythonConfig,
  grammar: { name: "tree-sitter-python", version: GRAMMAR_VERSION },
  // A getter, so the paths are computed on first use rather than at import.
  get queries() {
    return QUERY_NAMES.map((name) => ({ name, path: queryPath(`${name}.scm`) }));
  },
  resolver: pythonResolver,
  // Routes come from the framework packs, whose queries run only when routes are wanted.
  produces: ["imports", "symbols", "calls", "routes"],
  frameworks: [fastapi, flask, django],
  provenance: {
    ...Object.fromEntries(QUERY_NAMES.map((name) => [name, VERIFIED])),
    // What makes an import conditional: `typing.TYPE_CHECKING` is false at run time.
    "type-checking": {
      verifiedAgainst: ["Python 3.13"],
      verifiedOn: "2026-10-15",
      source: "https://docs.python.org/3.13/library/typing.html#typing.TYPE_CHECKING",
    },
    // A failed import raises ImportError, or its subclass ModuleNotFoundError when the module is not found.
    "optional-import": {
      verifiedAgainst: ["Python 3.13"],
      verifiedOn: "2026-10-15",
      source: "https://docs.python.org/3.13/reference/simple_stmts.html#the-import-statement",
    },
    // `__all__` lists the names `from m import *` binds.
    "dunder-all": {
      verifiedAgainst: ["Python 3.13"],
      verifiedOn: "2026-10-15",
      source: "https://docs.python.org/3.13/reference/simple_stmts.html#the-import-statement",
    },
    // Top-level modules recorded as stdlib rather than third-party.
    "stdlib-modules": PYTHON_STDLIB_PROVENANCE,
    // How an import maps to files: packages, modules, namespace packages, relative imports.
    "import-resolution": {
      verifiedAgainst: ["Python 3.13"],
      verifiedOn: "2026-10-15",
      source: "https://docs.python.org/3.13/reference/import.html",
    },
    // Declared distributions matched to imports by normalised name.
    "pep-503-names": {
      verifiedAgainst: ["PEP 503"],
      verifiedOn: "2026-10-15",
      source: "https://peps.python.org/pep-0503/#normalized-names",
    },
    // Calls whose module is a run-time value, counted in the notices.
    "dynamic-imports": {
      verifiedAgainst: ["Python 3.13"],
      verifiedOn: "2026-10-15",
      source: "https://docs.python.org/3.13/library/importlib.html#importlib.import_module",
    },
  },
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-python.wasm`. */
export const pythonGrammarPath = (): string => join(PYTHON_PACKAGE.grammarDir(), `${pythonPack.grammar.name}.wasm`);
