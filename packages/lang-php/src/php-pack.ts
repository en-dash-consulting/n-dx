/**
 * PHP language pack: the pinned tree-sitter-php grammar. It is built from the
 * release's `php/` grammar, which parses PHP mixed with HTML (`<?php … ?>`
 * blocks between markup, as legacy PHP 5 sites are written), not `php_only/`.
 * Without this pack, PHP files get inventory only: there is no other PHP
 * parser.
 *
 * The pack parses but has no queries yet, so it produces no facts.
 *
 * @module lang-php/php-pack
 */

import { join } from "node:path";
import { phpConfig } from "@n-dx/lang-kit";
import type { LanguagePack } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";

/**
 * Grammar release the pack was written and checked against. Keep in step
 * with `packages/lang-runtime/scripts/build-grammars.mjs`.
 */
const GRAMMAR_VERSION = "0.25.1";

export const phpPack: LanguagePack = {
  id: phpConfig.id,
  config: phpConfig,
  grammar: { name: "tree-sitter-php", version: GRAMMAR_VERSION },
  queries: [],
  produces: [],
  provenance: {},
};

/** Where the built grammar is read from: `build/grammars/tree-sitter-php.wasm`. */
export const phpGrammarPath = (): string => join(PHP_PACKAGE.grammarDir(), `${phpPack.grammar.name}.wasm`);
