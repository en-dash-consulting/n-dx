#!/usr/bin/env node
/**
 * Measure the PHP pack's grammar over the drift corpus.
 *
 *   node packages/sourcevision/scripts/php-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-php-corpus/ (override with NDX_PHP_CORPUS_DIR). The
 * files measured are the ones analyze would parse: sourcevision's project
 * walk under `phpConfig`'s skip rules (so a Composer-less `vendor/` is
 * measured) and `.gitignore`, keeping `phpConfig.parseableExtensions`. Per
 * repository it prints that file count, the files parsed with no ERROR or
 * MISSING node and their share, the ten most frequent parents of error nodes
 * with one example location each, and the parse time; then, kept out of the
 * D4 numbers, the same count and share for `.module`, `.install` and `.ctp`
 * files (Drupal's and CakePHP 2's PHP outside `parseableExtensions`). It ends
 * with an overall line and a line for the `php5: true` repositories, which
 * decision D4 holds to 99.5% clean.
 *
 * Exits 1 when the PHP 5 repositories are below the D4 bar, 2 when the
 * corpus, a build or the grammar is missing. Never touches the network; clone
 * with php-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-php build`, `pnpm --filter @n-dx/lang-php
 * build:grammars`, `pnpm --filter @n-dx/lang-runtime build` and
 * `pnpm --filter @n-dx/sourcevision build`.
 */

import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./php-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

/** Decision D4: share of the PHP 5 repositories' files that must parse with no ERROR or MISSING node. */
const D4_BAR = 0.995;
/** Below this the operator stops the lane (D4). */
const STOP_LINE = 0.95;
/** Large enough that no corpus file is skipped: the bar measures the grammar, not the size limit. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** PHP that analyze does not parse, reported apart from the D4 numbers. */
const OTHER_EXTENSIONS = new Set([".module", ".install", ".ctp"]);
const TOP_PARENTS = 10;
const ERROR_QUERY = fileURLToPath(new URL("./php-corpus-errors.scm", import.meta.url));

const json = process.argv.includes("--json");
const root = corpusDir();
const corpus = loadCorpus();

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ")}`);
  console.error(`Clone it with: ${CLONE_COMMAND}`);
  process.exit(2);
}

const runtimeDist = new URL("../../lang-runtime/dist/index.js", import.meta.url);
if (!existsSync(runtimeDist)) {
  console.error("lang-runtime is not built — run `pnpm --filter @n-dx/lang-runtime build`");
  process.exit(2);
}
const walkDist = new URL("../dist/util/project-walk.js", import.meta.url);
if (!existsSync(walkDist)) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);
const { loadIgnoreFilter, projectSkip, walkProjectFiles } = await import(walkDist.href);
const { phpConfig } = await importWorkspacePack("@n-dx/lang-kit");
const { phpGrammarPath } = await importWorkspacePack("@n-dx/lang-php");
const wasm = phpGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-php build:grammars\``);
  process.exit(2);
}

/** A stand-in pack whose only query reports error nodes and their parents. */
const target = { pack: { id: "php-corpus", queries: [{ name: "errors", path: ERROR_QUERY }] }, grammarPath: wasm };
const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const skip = projectSkip(phpConfig);

const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
const contains = (outer, inner) => before(outer.start, inner.start) && before(inner.end, outer.end);
const span = (c) => [c.end.line - c.start.line, c.end.column - c.start.column];
const smaller = (a, b) => {
  const [al, ac] = span(a);
  const [bl, bc] = span(b);
  return al < bl || (al === bl && ac < bc);
};
const sameNode = (a, b) =>
  a.nodeType === b.nodeType && a.start.line === b.start.line && a.start.column === b.start.column && a.end.line === b.end.line && a.end.column === b.end.column;

/**
 * Each error node with the type of the node holding it. The runner reports
 * captures, not trees, so the holder is the innermost `@*.parent` capture
 * whose range contains the error node's.
 */
function errorNodes(captures) {
  const parents = { error: [], missing: [] };
  const nodes = [];
  for (const c of captures) {
    if (c.name === "error.parent") parents.error.push(c);
    else if (c.name === "missing.parent") parents.missing.push(c);
    else nodes.push(c);
  }
  return nodes.map((node) => {
    let holder;
    for (const p of parents[node.name]) {
      if (sameNode(p, node) || !contains(p, node)) continue;
      if (holder === undefined || smaller(p, holder)) holder = p;
    }
    return {
      kind: node.name === "missing" ? `MISSING ${node.nodeType}` : "ERROR",
      parent: holder?.nodeType ?? "?",
      line: node.start.line,
      column: node.start.column + 1,
    };
  });
}

const share = (s) => (s.files === 0 ? 0 : s.clean / s.files);
const percent = (s) => (s.files === 0 ? "no files" : `${s.clean}/${s.files} = ${(share(s) * 100).toFixed(2)}%`);

const results = [];
try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const parseable = { files: 0, clean: 0 };
    const other = { files: 0, clean: 0 };
    const parents = new Map();
    const failing = [];
    let skipped = 0;
    let seconds = 0;
    const ig = await loadIgnoreFilter(dir);
    for await (const path of walkProjectFiles(dir, dir, ig, skip)) {
      const ext = extname(path);
      const measured = phpConfig.parseableExtensions.has(ext);
      if (!measured && !OTHER_EXTENSIONS.has(ext)) continue;
      const stats = measured ? parseable : other;
      stats.files++;
      const start = performance.now();
      const result = await runner.parseFile(target, join(dir, path));
      seconds += (performance.now() - start) / 1000;
      if (result.status === "skipped") {
        skipped++;
        continue;
      }
      if (!result.hasErrorNodes && !result.hasMissingNodes) {
        stats.clean++;
        continue;
      }
      if (!measured) continue;
      failing.push(path);
      for (const node of errorNodes(result.captures.errors)) {
        const entry = parents.get(node.parent) ?? { parent: node.parent, count: 0, example: `${path}:${node.line}:${node.column} (${node.kind})` };
        entry.count++;
        parents.set(node.parent, entry);
      }
    }
    results.push({
      name: repo.name,
      php5: repo.php5 === true,
      sha: checkedOutSha(dir),
      pinnedSha: repo.sha,
      ...parseable,
      cleanShare: share(parseable),
      other: { ...other, cleanShare: share(other) },
      skipped,
      seconds,
      topParents: [...parents.values()].sort((a, b) => b.count - a.count || a.parent.localeCompare(b.parent)).slice(0, TOP_PARENTS),
      failing,
    });
  }
} finally {
  runner.dispose();
}

const total = (rows) => rows.reduce((t, r) => ({ files: t.files + r.files, clean: t.clean + r.clean }), { files: 0, clean: 0 });
const overall = total(results);
const php5 = total(results.filter((r) => r.php5));
const d4 = share(php5) >= D4_BAR ? "met" : share(php5) >= STOP_LINE ? "NOT met" : `NOT met, below the ${STOP_LINE * 100}% stop line`;

if (json) {
  console.log(
    JSON.stringify(
      { corpusDir: root, results, overall: { ...overall, cleanShare: share(overall) }, php5: { ...php5, cleanShare: share(php5), d4 } },
      null,
      2,
    ),
  );
} else {
  console.log(`corpus: ${root}`);
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${r.php5 ? "  [PHP 5]" : ""}${drift}`);
    console.log(`  PHP files:      ${r.files}  (skipped oversized: ${r.skipped})`);
    console.log(`  clean parse:    ${percent(r)}`);
    console.log(`  parse time:     ${r.seconds.toFixed(1)} s`);
    for (const p of r.topParents) console.log(`  error parent:   ${p.parent} ×${p.count}  e.g. ${p.example}`);
    console.log(`  .module/.install/.ctp (not in D4): ${percent(r.other)}`);
  }
  console.log(`\noverall:        ${percent(overall)}`);
  console.log(`PHP 5 repos:    ${percent(php5)}  — D4 (>= ${D4_BAR * 100}%): ${d4}`);
}
process.exit(share(php5) >= D4_BAR ? 0 : 1);
