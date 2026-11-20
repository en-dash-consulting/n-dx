#!/usr/bin/env node
/**
 * Where the PHP grammar fails on a file, as positions and grammar node types
 * only: never the file's text, so its output can leave a client machine.
 *
 *   node packages/lang-php/scripts/php-parse-errors.mjs <file.php> [...]
 *
 * Each file is parsed as the pack parses it (the legacy-syntax rewrite of
 * `$s{0}` first, src/php-legacy-syntax.ts). For each ERROR node: its line and
 * column, its parent's type, the node types before and after it, and the
 * types of its first children (anonymous tokens show as their grammar token,
 * `{` or `function`; names and strings as `name`, `string`). For each MISSING
 * node: what the grammar expected there. A clean file prints `clean`.
 * Needs the built package (`pnpm --filter @n-dx/lang-php build`) and grammar.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { phpGrammarPath } from "../dist/index.js";
import { rewriteLegacySyntax } from "../dist/php-legacy-syntax.js";

const require = createRequire(fileURLToPath(import.meta.resolve("@n-dx/lang-runtime")));
const { Parser, Language } = await import(require.resolve("web-tree-sitter"));

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: php-parse-errors.mjs <file.php> [...]");
  process.exit(2);
}
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(phpGrammarPath()));

const at = (node) => `${node.startPosition.row + 1}:${node.startPosition.column}`;
const kind = (node) => (node ? node.type : "-");

for (const path of files) {
  const source = readFileSync(path, "utf8");
  const rewritten = rewriteLegacySyntax(source);
  const tree = parser.parse(rewritten?.source ?? source);
  const lines = [];
  const walk = (node) => {
    if (node.isMissing) lines.push(`  ${at(node)} MISSING ${node.type} in ${kind(node.parent)}`);
    else if (node.isError || node.type === "ERROR") {
      const children = node.children.slice(0, 8).map(kind).join(" ");
      lines.push(`  ${at(node)} ERROR in ${kind(node.parent)} after ${kind(node.previousSibling)} before ${kind(node.nextSibling)}: ${children}`);
    }
    if (node.hasError || node.isMissing) for (const child of node.children) walk(child);
  };
  if (tree.rootNode.hasError) walk(tree.rootNode);
  const rewrites = rewritten ? ` (${rewritten.rewrites.length} brace offsets rewritten)` : "";
  console.log(`${path}${rewrites}: ${lines.length === 0 ? "clean" : `${lines.length} error node(s)`}`);
  for (const line of lines.slice(0, 20)) console.log(line);
  if (lines.length > 20) console.log(`  … ${lines.length - 20} more`);
}
