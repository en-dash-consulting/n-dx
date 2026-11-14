#!/usr/bin/env node
/**
 * Measure the PHP namespace resolver over the drift corpus.
 *
 *   node packages/sourcevision/scripts/php-resolve-report.mjs [--json] [--sample N] [--seed S] [repo...]
 *
 * Reads ~/.cache/ndx-php-corpus/ (override with NDX_PHP_CORPUS_DIR). The
 * files are the ones analyze would parse (sourcevision's project walk under
 * `phpConfig`'s skip rules and `.gitignore`, keeping
 * `phpConfig.parseableExtensions`), less any Composer `config.vendor-dir`;
 * they are resolved as the pack does in `analyze`. Per repository it prints:
 * - the Composer manifests found, or `no composer` when there is none;
 * - internal references resolved / internal total, and how they resolved
 *   (PSR-4, PSR-0, classmap, declared). A reference is internal when it
 *   resolved or names the project's own namespace. A repository without
 *   Composer prints its reference count instead of a rate;
 * - externals (matched to a composer.lock package / total), PHP built-ins
 *   and global functions or constants;
 * - the most frequent unresolved names, and the most referenced externals;
 * - a random sample of N resolved and N unresolved references (default 20,
 *   seeded so a re-run picks the same ones) with file:line and the line as
 *   written, for checking by hand.
 * Exits 2 when the corpus, a build or the grammar is missing. Never touches
 * the network; clone with php-corpus-clone.mjs. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-php build`, `pnpm --filter @n-dx/lang-php
 * build:grammars`, `pnpm --filter @n-dx/lang-runtime build` and
 * `pnpm --filter @n-dx/sourcevision build`.
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { CLONE_COMMAND, CORPUS_DIR_ENV, checkedOutSha, corpusDir, loadCorpus } from "./php-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const valueOf = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const SAMPLE = valueOf("--sample", 20);
const SEED = valueOf("--seed", 1);
const only = args.filter((a, i) => !a.startsWith("--") && !["--sample", "--seed"].includes(args[i - 1]));
const TOP = 15;
const root = corpusDir();
const corpus = loadCorpus().filter((repo) => only.length === 0 || only.includes(repo.name));

const missing = corpus.filter((repo) => checkedOutSha(join(root, repo.name)) === undefined);
if (corpus.length === 0 || missing.length > 0) {
  console.error(`Corpus incomplete in ${root} (${CORPUS_DIR_ENV} overrides). Missing: ${missing.map((r) => r.name).join(", ") || only.join(", ")}`);
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
const { phpGrammarPath, phpPack, preparePhpImports, readPhpResolveProjects } = await importWorkspacePack("@n-dx/lang-php");
const wasm = phpGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-php build:grammars\``);
  process.exit(2);
}

/** mulberry32: a small seeded generator, so a sample can be drawn again. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` items drawn at random from `items` without replacement, in their original order. */
function sample(items, n, random) {
  if (items.length <= n) return items;
  const picked = new Set();
  while (picked.size < n) picked.add(Math.floor(random() * items.length));
  return [...picked].sort((a, b) => a - b).map((i) => items[i]);
}

const under = (path, dir) => dir === "" || path.startsWith(`${dir}/`);
const top = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP);
const bump = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);

const runner = createTreeSitterRunner();
const target = { pack: phpPack, grammarPath: wasm };
const skip = projectSkip(phpConfig);
const results = [];

try {
  for (const repo of corpus) {
    const dir = join(root, repo.name);
    const ig = await loadIgnoreFilter(dir);
    const walked = [];
    for await (const path of walkProjectFiles(dir, dir, ig, skip)) {
      if (phpConfig.parseableExtensions.has(extname(path))) walked.push(path);
    }
    walked.sort();
    const t0 = performance.now();
    const projects = await readPhpResolveProjects(dir, walked);
    const vendorDirs = projects.map((p) => p.vendorDir);
    const paths = walked.filter((p) => !vendorDirs.some((v) => under(p, v)));
    const parsed = [];
    const unparsed = [];
    for (const path of paths) {
      const result = await runner.parseFile(target, join(dir, path));
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
      else unparsed.push(path);
    }
    const parseSeconds = (performance.now() - t0) / 1000;
    const t1 = performance.now();
    const prepared = preparePhpImports(projects, parsed, unparsed);
    const resolveSeconds = (performance.now() - t1) / 1000;

    const counts = { references: 0, internal: 0, internalResolved: 0, builtin: 0, global: 0, external: 0, matched: 0 };
    const via = {};
    const unresolvedReasons = {};
    const unresolvedNames = new Map();
    const externals = new Map();
    const resolvedList = [];
    const unresolvedList = [];
    for (const file of parsed) {
      for (const { reference, outcome } of prepared.outcomes(file.path)) {
        counts.references++;
        const at = { file: file.path, line: reference.position.line, form: reference.form, qualified: reference.qualified };
        switch (outcome.kind) {
          case "internal":
            counts.internal++;
            counts.internalResolved++;
            via[outcome.via] = (via[outcome.via] ?? 0) + 1;
            resolvedList.push({ ...at, to: outcome.target, via: outcome.via });
            break;
          case "unresolved":
            counts.internal++;
            unresolvedReasons[outcome.reason] = (unresolvedReasons[outcome.reason] ?? 0) + 1;
            bump(unresolvedNames, reference.qualified);
            unresolvedList.push({ ...at, reason: outcome.reason });
            break;
          case "external":
            counts.external++;
            if (outcome.dependency) counts.matched++;
            bump(externals, outcome.dependency ? `${outcome.package} (${outcome.dependency})` : outcome.package);
            break;
          case "builtin":
            counts.builtin++;
            break;
          case "global":
            counts.global++;
            break;
        }
      }
    }
    const random = seeded(SEED);
    const lineOf = (s) => readFileSync(join(dir, s.file), "utf8").split("\n")[s.line - 1]?.trim();
    results.push({
      name: repo.name,
      sha: checkedOutSha(dir),
      pinnedSha: repo.sha,
      composer: projects.map((p) => p.dir || "."),
      lockFiles: projects.filter((p) => p.lockPackages !== undefined).length,
      files: paths.length,
      unparsed: unparsed.length,
      parseSeconds,
      resolveSeconds,
      counts,
      via,
      unresolved: unresolvedReasons,
      topUnresolved: top(unresolvedNames),
      topExternal: top(externals),
      notices: prepared.notices?.() ?? [],
      sampleResolved: sample(resolvedList, SAMPLE, random).map((s) => ({ ...s, text: lineOf(s) })),
      sampleUnresolved: sample(unresolvedList, SAMPLE, random).map((s) => ({ ...s, text: lineOf(s) })),
    });
  }
} finally {
  runner.dispose();
}

const pct = (a, b) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`);
const rateOf = (r) =>
  r.composer.length === 0
    ? `no composer (${r.counts.references} references)`
    : `${r.counts.internalResolved}/${r.counts.internal} = ${pct(r.counts.internalResolved, r.counts.internal)}`;

if (json) {
  console.log(JSON.stringify({ corpusDir: root, seed: SEED, results }, null, 2));
} else {
  console.log(`corpus: ${root}  (sample seed ${SEED})`);
  for (const r of results) {
    const c = r.counts;
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  composer.json: ${r.composer.join(" ") || "none"}; with composer.lock: ${r.lockFiles}`);
    console.log(`  PHP files: ${r.files} (unparsed: ${r.unparsed}); references: ${c.references}`);
    console.log(`  internal resolved: ${rateOf(r)}`);
    console.log(`    by: ${Object.entries(r.via).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);
    console.log(`    unresolved: ${Object.entries(r.unresolved).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);
    console.log(`  externals: ${c.external}, matched to a composer.lock package: ${pct(c.matched, c.external)}`);
    console.log(`  PHP built-ins: ${c.builtin}; global functions and constants: ${c.global}`);
    console.log(`  most frequent unresolved: ${r.topUnresolved.map(([n, k]) => `${n}(${k})`).join(" ") || "none"}`);
    console.log(`  most referenced externals: ${r.topExternal.map(([n, k]) => `${n}(${k})`).join(" ") || "none"}`);
    console.log(`  time: parse ${r.parseSeconds.toFixed(1)} s, resolution ${r.resolveSeconds.toFixed(2)} s`);
    for (const n of r.notices) console.log(`  notice: ${n}`);
    console.log("  sample, resolved:");
    for (const s of r.sampleResolved) console.log(`    ${s.file}:${s.line}  ${s.text}  [${s.form} ${s.qualified}]  ->  ${s.to} (${s.via})`);
    console.log("  sample, unresolved:");
    for (const s of r.sampleUnresolved) console.log(`    ${s.file}:${s.line}  ${s.text}  [${s.form} ${s.qualified}]  ${s.reason}`);
  }
}
