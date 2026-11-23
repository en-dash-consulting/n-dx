#!/usr/bin/env node

/**
 * Print how many times the test suite executed each source line.
 *
 * Reads the `coverage-final.json` a package's `test:coverage` run writes
 * (V8 counts in istanbul's shape) and prints one row per executable line:
 * its hit count and its source. Lines that never ran are marked `!!`.
 *
 * Usage:
 *   node scripts/coverage-lines.mjs <package> [path-filter] [--uncovered] [--hot <n>]
 *
 *   <package>      package directory name under packages/ (rex, web, …)
 *   path-filter    only files whose package-relative path contains this text
 *   --uncovered    print only the lines that never ran
 *   --hot <n>      instead of per-file listings, print the <n> most-executed
 *                  lines across the matching files
 *
 * Without a filter or --hot it prints a per-file table (lines, lines hit,
 * lines missed), sorted by most lines missed, so the gaps are read first.
 *
 * Run `pnpm --filter @n-dx/<package> test:coverage` first.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { invokedDirectly } from "./lib/invoked-directly.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Hit count per source line for one file's istanbul coverage entry.
 *
 * A line's count is the highest count of any statement starting on it — the
 * rule istanbul's own lcov and HTML reporters use, so the numbers here match
 * the `12x` gutter in the HTML report and the `DA:` records in lcov.info.
 *
 * @param {{ statementMap: Record<string, { start: { line: number } }>, s: Record<string, number> }} fileCoverage
 * @returns {Map<number, number>} line number → times executed, ascending by line
 */
export function lineHits(fileCoverage) {
  /** @type {Map<number, number>} */
  const hits = new Map();
  for (const [id, loc] of Object.entries(fileCoverage.statementMap)) {
    const line = loc.start.line;
    const count = fileCoverage.s[id] ?? 0;
    const prev = hits.get(line);
    if (prev === undefined || count > prev) hits.set(line, count);
  }
  return new Map([...hits].sort((a, b) => a[0] - b[0]));
}

/**
 * Per-file line totals, most missed lines first.
 *
 * @param {Record<string, any>} coverage  Parsed coverage-final.json.
 * @param {(path: string) => string} label  Display name for an absolute path.
 * @returns {Array<{ file: string, lines: number, hit: number, missed: number }>}
 */
export function fileTable(coverage, label) {
  const rows = Object.entries(coverage).map(([path, fc]) => {
    const counts = [...lineHits(fc).values()];
    const hit = counts.filter((n) => n > 0).length;
    return { file: label(path), lines: counts.length, hit, missed: counts.length - hit };
  });
  return rows.sort((a, b) => b.missed - a.missed || a.file.localeCompare(b.file));
}

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/coverage-lines.mjs <package> [path-filter] [--uncovered] [--hot <n>]");
  process.exit(2);
}

function main(argv) {
  const uncoveredOnly = argv.includes("--uncovered");
  const hotAt = argv.indexOf("--hot");
  const hot = hotAt >= 0 ? Number(argv[hotAt + 1]) : 0;
  if (hotAt >= 0 && !(Number.isInteger(hot) && hot > 0)) usage("--hot takes a positive whole number");
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(hotAt >= 0 && i === hotAt + 1));
  const [pkg, filter] = positional;
  if (!pkg) usage();

  const pkgDir = resolve(ROOT, "packages", pkg);
  const reportPath = join(pkgDir, "coverage", "coverage-final.json");
  if (!existsSync(reportPath)) {
    usage(`No coverage report at ${relative(ROOT, reportPath)}. Run: pnpm --filter ./packages/${pkg} test:coverage`);
  }

  const coverage = JSON.parse(readFileSync(reportPath, "utf8"));
  const label = (p) => relative(pkgDir, p).split("\\").join("/");
  const matching = Object.fromEntries(Object.entries(coverage).filter(([p]) => !filter || label(p).includes(filter)));
  if (Object.keys(matching).length === 0) usage(`No covered file in ${pkg} matches "${filter}".`);

  if (hot) {
    const all = [];
    for (const [path, fc] of Object.entries(matching)) {
      const src = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
      for (const [line, n] of lineHits(fc)) all.push({ n, where: `${label(path)}:${line}`, text: (src[line - 1] ?? "").trim() });
    }
    all.sort((a, b) => b.n - a.n);
    for (const { n, where, text } of all.slice(0, hot)) console.log(`${String(n).padStart(10)}  ${where}  ${text}`);
    return;
  }

  if (!filter && !uncoveredOnly) {
    console.log(`${"missed".padStart(7)} ${"hit".padStart(7)} ${"lines".padStart(7)}  file`);
    for (const r of fileTable(matching, label)) {
      console.log(`${String(r.missed).padStart(7)} ${String(r.hit).padStart(7)} ${String(r.lines).padStart(7)}  ${r.file}`);
    }
    return;
  }

  for (const [path, fc] of Object.entries(matching)) {
    const src = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
    const rows = [...lineHits(fc)].filter(([, n]) => !uncoveredOnly || n === 0);
    if (rows.length === 0) continue;
    console.log(`\n── ${label(path)}`);
    for (const [line, n] of rows) {
      const mark = n === 0 ? "!!" : "  ";
      console.log(`${mark}${String(n).padStart(8)}x ${String(line).padStart(5)}  ${src[line - 1] ?? ""}`);
    }
  }
}

if (invokedDirectly(import.meta.url)) main(process.argv.slice(2));
