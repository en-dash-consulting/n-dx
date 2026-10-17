#!/usr/bin/env node
/**
 * Measure the tree-sitter-hcl grammar over the Terraform drift corpus.
 *
 *   node packages/sourcevision/scripts/tf-corpus-report.mjs [--json]
 *
 * Reads ~/.cache/ndx-iac-corpus/ (override with NDX_IAC_CORPUS_DIR) and the Go
 * corpus (NDX_GO_CORPUS_DIR) for microservices-demo. Per repository prints the
 * `.tf` and `.tfvars` file counts, the share of each parsed without ERROR or
 * MISSING nodes, and the failing constructs (file, position, first line of the
 * node). Exits 1 when a repository is below the clean-parse gate (98%) for
 * `.tf` files, 2 when a checkout, the build or the grammar is missing; a
 * missing checkout prints its clone command. Never touches the network. Not
 * part of the test run. It measures the grammar only: no queries, no model.
 *
 * Needs `pnpm --filter @n-dx/lang-terraform build` and
 * `pnpm --filter @n-dx/lang-terraform build:grammars`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { checkedOutSha, cloneCommand, loadCorpus, repoDir } from "./tf-corpus.mjs";

/** Share of `.tf` files that must parse without ERROR or MISSING nodes. */
const CLEAN_SHARE_GATE = 0.98;
/** Large enough that no corpus file is skipped: the gate measures the grammar, not the size limit. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", ".terraform", "node_modules"]);
const EXTENSIONS = [".tf", ".tfvars"];
const LISTED = 20;
const ERROR_QUERY = fileURLToPath(new URL("./tf-corpus-errors.scm", import.meta.url));

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield join(dir, entry.name);
    }
  }
}

const clip = (text) => {
  const line = text.trim();
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
};

const share = (stats) => (stats.files === 0 ? 1 : stats.clean / stats.files);

const json = process.argv.includes("--json");
const corpus = loadCorpus();

const missing = corpus.filter((repo) => checkedOutSha(repoDir(repo)) === undefined);
if (missing.length > 0) {
  for (const repo of missing) {
    console.error(`${repo.name}: no checkout at ${repoDir(repo)}`);
    console.error(`  clone it with: ${cloneCommand(repo)}`);
  }
  process.exit(2);
}

const runtimeDist = new URL("../../lang-runtime/dist/index.js", import.meta.url);
if (!existsSync(runtimeDist)) {
  console.error("lang-runtime is not built — run `pnpm --filter @n-dx/lang-runtime build`");
  process.exit(2);
}
const terraformDist = new URL("../../lang-terraform/dist/index.js", import.meta.url);
if (!existsSync(terraformDist)) {
  console.error("lang-terraform is not built — run `pnpm --filter @n-dx/lang-terraform build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);
const { terraformGrammarPath } = await import(terraformDist.href);

const wasm = terraformGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-terraform build:grammars\``);
  process.exit(2);
}

/** A stand-in pack whose only query reports error nodes; the Terraform pack's queries come later. */
const pack = { id: "terraform-corpus", queries: [{ name: "errors", path: ERROR_QUERY }] };
const target = { pack, grammarPath: wasm };
const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const results = [];

try {
  for (const repo of corpus) {
    const dir = repoDir(repo);
    const byExt = Object.fromEntries(EXTENSIONS.map((ext) => [ext, { files: 0, clean: 0 }]));
    const failing = [];
    const start = performance.now();
    for (const file of walk(dir)) {
      const stats = byExt[EXTENSIONS.find((ext) => file.endsWith(ext))];
      stats.files++;
      const result = await runner.parseFile(target, file);
      if (result.status === "skipped") continue;
      if (!result.hasErrorNodes && !result.hasMissingNodes) {
        stats.clean++;
        continue;
      }
      // A MISSING node is zero-width, so its own text is empty: show the source line it sits on.
      const lines = readFileSync(file, "utf8").split("\n");
      failing.push({
        file: relative(dir, file),
        constructs: result.captures.errors.map((c) => ({
          kind: c.name === "missing" ? `MISSING ${c.nodeType}` : "ERROR",
          line: c.start.line,
          text: clip(lines[c.start.line - 1] ?? ""),
        })),
      });
    }
    results.push({
      name: repo.name,
      sha: checkedOutSha(dir),
      pinnedSha: repo.sha,
      tf: { ...byExt[".tf"], cleanShare: share(byExt[".tf"]) },
      tfvars: { ...byExt[".tfvars"], cleanShare: share(byExt[".tfvars"]) },
      seconds: (performance.now() - start) / 1000,
      failing,
    });
  }
} finally {
  runner.dispose();
}

// A repository with no .tf files cannot meet the gate: the corpus is mis-pinned.
const failedGate = results.filter((r) => r.tf.files === 0 || r.tf.cleanShare < CLEAN_SHARE_GATE);

if (json) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  for (const r of results) {
    const drift = r.sha === r.pinnedSha ? "" : `  (checked out ${r.sha}, pinned ${r.pinnedSha})`;
    console.log(`\n${r.name} @ ${r.pinnedSha.slice(0, 12)}${drift}`);
    console.log(`  .tf files:           ${r.tf.files}`);
    console.log(`  .tfvars files:       ${r.tfvars.files}`);
    console.log(`  clean parse .tf:     ${r.tf.clean}/${r.tf.files} = ${(r.tf.cleanShare * 100).toFixed(2)}%`);
    console.log(`  clean parse .tfvars: ${r.tfvars.clean}/${r.tfvars.files} = ${(r.tfvars.cleanShare * 100).toFixed(2)}%`);
    console.log(`  parse time:          ${r.seconds.toFixed(1)} s`);
    for (const f of r.failing.slice(0, LISTED)) {
      console.log(`  not clean:           ${f.file}`);
      for (const c of f.constructs.slice(0, 3)) console.log(`                         ${c.kind} line ${c.line}: ${c.text}`);
    }
    if (r.failing.length > LISTED) console.log(`  ... and ${r.failing.length - LISTED} more not clean`);
  }
  const verdict = failedGate.length === 0 ? "met" : `NOT met by ${failedGate.map((r) => r.name).join(", ")}`;
  console.log(`\nClean-parse gate (.tf >= ${CLEAN_SHARE_GATE * 100}%): ${verdict}`);
}
process.exit(failedGate.length === 0 ? 0 : 1);
