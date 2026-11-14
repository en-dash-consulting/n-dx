/**
 * PHP language pack: the pinned tree-sitter-php grammar, the structure
 * queries under `queries/php/`, the imports as written (`php-imports.ts`)
 * and the symbol rules (`php-symbols.ts`). The grammar is built from the
 * release's `php/` grammar, which parses PHP mixed with HTML (`<?php … ?>`
 * blocks between markup, as legacy PHP 5 sites are written), not
 * `php_only/`. Without this pack, PHP files get inventory only: there is no
 * other PHP parser.
 *
 * `use` imports and class references resolve to files through Composer's
 * autoload rules (`php-resolver.ts`); includes are reported as written.
 *
 * @module lang-php/php-pack
 */

import { join } from "node:path";
import { phpConfig } from "@n-dx/lang-kit";
import type { LanguagePack, RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { PHP_BUILTINS_PROVENANCE } from "./php-builtins.js";
import { phpResolver } from "./php-resolver.js";

const QUERY_NAMES = ["imports", "guards", "definitions", "calls", "references"] as const;

/** Query files ship in `queries/php`; see `package-paths.ts`. */
const queryPath = (file: string): string => join(PHP_PACKAGE.queryDir("php"), file);

/**
 * Grammar release the pack was written and checked against. Keep in step
 * with `packages/lang-runtime/scripts/build-grammars.mjs`; update `verifiedOn` when re-checking.
 */
const GRAMMAR_VERSION = "0.25.1";

/** The queries were written against the grammar's node types and checked on the fixture goldens. */
const VERIFIED: RuleProvenance = {
  verifiedAgainst: [`tree-sitter-php@${GRAMMAR_VERSION}`],
  verifiedOn: "2026-11-14",
  source: `https://github.com/tree-sitter/tree-sitter-php/blob/v${GRAMMAR_VERSION}/php/src/node-types.json`,
};

export const phpPack: LanguagePack = {
  id: phpConfig.id,
  config: phpConfig,
  grammar: { name: "tree-sitter-php", version: GRAMMAR_VERSION },
  // A getter, so the paths are computed on first use rather than at import.
  get queries() {
    return QUERY_NAMES.map((name) => ({ name, path: queryPath(`${name}.scm`) }));
  },
  resolver: phpResolver,
  produces: ["imports", "symbols", "calls"],
  provenance: {
    ...Object.fromEntries(QUERY_NAMES.map((name) => [name, VERIFIED])),
    // Constructors: `__construct`, and a method named as its class (the old style) in a class outside a namespace without `__construct`.
    constructors: {
      verifiedAgainst: [`tree-sitter-php@${GRAMMAR_VERSION}`],
      verifiedOn: "2026-11-14",
      source: "https://www.php.net/manual/en/language.oop5.decon.php",
    },
    // `define()` declares a global constant wherever it is called.
    define: {
      verifiedAgainst: [`tree-sitter-php@${GRAMMAR_VERSION}`],
      verifiedOn: "2026-11-14",
      source: "https://www.php.net/manual/en/function.define.php",
    },
    // `include`, `include_once`, `require` and `require_once` evaluate a path expression at run time.
    includes: {
      verifiedAgainst: [`tree-sitter-php@${GRAMMAR_VERSION}`],
      verifiedOn: "2026-11-14",
      source: "https://www.php.net/manual/en/function.include.php",
    },
    // `use` imports: classes and namespaces, `use function`, `use const`, group use and `as` aliases.
    "use-imports": {
      verifiedAgainst: [`tree-sitter-php@${GRAMMAR_VERSION}`],
      verifiedOn: "2026-11-14",
      source: "https://www.php.net/manual/en/language.namespaces.importing.php",
    },
    // How a class, function or constant name is qualified: `\`, `namespace\`, imports, the current namespace, the global fallback for functions and constants.
    "name-resolution": {
      verifiedAgainst: ["PHP manual"],
      verifiedOn: "2026-11-14",
      source: "https://www.php.net/manual/en/language.namespaces.rules.php",
    },
    // PSR-4: the prefix is cut and the rest, `\` to `/`, is a `.php` file under the prefix's directories.
    "psr-4": {
      verifiedAgainst: ["PSR-4"],
      verifiedOn: "2026-11-14",
      source: "https://www.php-fig.org/psr/psr-4/",
    },
    // PSR-0: the namespace's `\` and the class name's `_` become `/`, under the prefix's directories.
    "psr-0": {
      verifiedAgainst: ["PSR-0"],
      verifiedOn: "2026-11-14",
      source: "https://www.php-fig.org/psr/psr-0/",
    },
    // Composer's autoload keys: psr-4, psr-0, classmap and exclude-from-classmap.
    "composer-autoload": {
      verifiedAgainst: ["Composer documentation"],
      verifiedOn: "2026-11-14",
      source: "https://getcomposer.org/doc/04-schema.md#autoload",
    },
    // PHP's own classes and interfaces, never externals.
    builtins: PHP_BUILTINS_PROVENANCE,
  },
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-php.wasm`. */
export const phpGrammarPath = (): string => join(PHP_PACKAGE.grammarDir(), `${phpPack.grammar.name}.wasm`);
