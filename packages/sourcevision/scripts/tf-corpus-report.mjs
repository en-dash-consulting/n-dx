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
 * node). Then the Terraform model over the `.tf` files: resources, data
 * sources, module calls by source kind, module instances and the resource
 * facts resolved through them, and the comparison with
 * `analyzers/infrastructure.ts`'s resources (`discoverFromIaC`). The model must
 * be a superset: every resource infrastructure.ts finds is listed if the model
 * misses it, and every resource only the model has is listed by type.
 *
 * Exits 1 when a repository is below the clean-parse gate (98%) for `.tf`
 * files or the model is not a superset, 2 when a checkout, the build or the
 * grammar is missing; a missing checkout prints its clone command. Never
 * touches the network. Not part of the test run.
 *
 * Needs `pnpm --filter @n-dx/lang-terraform build`,
 * `pnpm --filter @n-dx/lang-terraform build:grammars` and
 * `pnpm --filter @n-dx/sourcevision build`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { checkedOutSha, cloneCommand, loadCorpus, repoDir } from "./tf-corpus.mjs";
import { importWorkspacePack } from "./workspace-pack.mjs";

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
const infrastructureDist = new URL("../dist/analyzers/infrastructure.js", import.meta.url);
if (!existsSync(infrastructureDist)) {
  console.error("sourcevision is not built — run `pnpm --filter @n-dx/sourcevision build`");
  process.exit(2);
}
const { createTreeSitterRunner } = await import(runtimeDist.href);
const { discoverFromIaC } = await import(infrastructureDist.href);
const { IAC_KINDS } = await importWorkspacePack("@n-dx/lang-kit");
const { buildTerraformModel, terraformGrammarPath, terraformPack, terraformResourceFacts } = await importWorkspacePack("@n-dx/lang-terraform");

const wasm = terraformGrammarPath();
if (!existsSync(wasm)) {
  console.error(`${wasm} is not built — run \`pnpm --filter @n-dx/lang-terraform build:grammars\``);
  process.exit(2);
}

/** A stand-in pack whose only query reports error nodes, for the clean-parse measure. */
const pack = { id: "terraform-corpus", queries: [{ name: "errors", path: ERROR_QUERY }] };
const target = { pack, grammarPath: wasm };
const modelTarget = { pack: terraformPack, grammarPath: wasm };
const runner = createTreeSitterRunner({ maxFileBytes: MAX_FILE_BYTES });
const results = [];

/** infrastructure.ts's `classifyResource` for a Terraform type: the same table, the same normalisation. */
const classified = (type) => {
  const normalized = type.toLowerCase().replace(/::/g, "_").replace(/-/g, "_");
  return IAC_KINDS.some(([pattern]) => pattern.test(normalized));
};

/** The model's numbers for one repository, and how its resources compare with infrastructure.ts's. */
function modelReport(dir, parsed) {
  const model = buildTerraformModel(parsed);
  const modules = { local: 0, followed: 0, registry: 0, other: 0 };
  for (const call of model.modules) {
    modules[call.sourceKind]++;
    if (call.followed) modules.followed++;
  }
  // infrastructure.ts keys a resource by `type.name` across the repository.
  const modelIds = new Set(model.resources.map((r) => r.address));
  const infraIds = new Set(discoverFromIaC(dir).infrastructure.filter((i) => i.origin.endsWith(".tf")).map((i) => i.id.slice("infra:".length)));
  const missing = [...infraIds].filter((id) => !modelIds.has(id)).sort();
  const extraByType = {};
  for (const id of modelIds) {
    if (infraIds.has(id)) continue;
    const type = id.slice(0, id.indexOf("."));
    extraByType[type] ??= { count: 0, classified: classified(type) };
    extraByType[type].count++;
  }
  return {
    resources: model.resources.length,
    distinctResources: modelIds.size,
    dataSources: model.dataSources.length,
    modules,
    registryModulesMatched: model.modules.filter((m) => m.declares).length,
    moduleDirectories: model.modulePaths.size,
    withAttributes: model.resources.filter((r) => Object.keys(r.attributes).length > 0).length,
    references: model.references.length,
    instances: model.instances.length,
    rootInstances: model.instances.filter((i) => i.parent === undefined).length,
    resolvedFacts: [...terraformResourceFacts(model, parsed.map((f) => f.path)).values()]
      .flatMap((f) => f.resources ?? [])
      .filter((fact) => fact.instance !== undefined).length,
    infrastructure: infraIds.size,
    missing,
    extraByType: Object.fromEntries(Object.entries(extraByType).sort(([a], [b]) => a.localeCompare(b))),
  };
}

try {
  for (const repo of corpus) {
    const dir = repoDir(repo);
    const byExt = Object.fromEntries(EXTENSIONS.map((ext) => [ext, { files: 0, clean: 0 }]));
    const failing = [];
    const parsed = [];
    const start = performance.now();
    for (const file of walk(dir)) {
      const stats = byExt[EXTENSIONS.find((ext) => file.endsWith(ext))];
      stats.files++;
      if (file.endsWith(".tf")) {
        const structure = await runner.parseFile(modelTarget, file);
        if (structure.status === "parsed") parsed.push({ path: relative(dir, file).split("\\").join("/"), captures: structure.captures });
      }
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
      model: modelReport(dir, parsed),
    });
  }
} finally {
  runner.dispose();
}

// A repository with no .tf files cannot meet the gate: the corpus is mis-pinned.
const failedGate = results.filter((r) => r.tf.files === 0 || r.tf.cleanShare < CLEAN_SHARE_GATE);
const notSuperset = results.filter((r) => r.model.missing.length > 0);

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
    const m = r.model;
    console.log(`  model resources:     ${m.resources} (${m.distinctResources} distinct type.name), ${m.withAttributes} with audit attributes`);
    console.log(`  model data sources:  ${m.dataSources}`);
    console.log(
      `  module calls:        ${m.modules.local} local (${m.modules.followed} followed), ${m.modules.registry} registry ` +
        `(${m.registryModulesMatched} in the table), ${m.modules.other} other; ${m.moduleDirectories} directories reached by a call`,
    );
    console.log(`  module instances:    ${m.instances} (${m.rootInstances} root); ${m.resolvedFacts} resource facts resolved per instance`);
    console.log(`  reference edges:     ${m.references}`);
    console.log(`  infrastructure.ts:   ${m.infrastructure} resources; missing from the model: ${m.missing.length}`);
    for (const id of m.missing) console.log(`    missing ${id}`);
    const extra = Object.entries(m.extraByType);
    console.log(`  model only:          ${extra.reduce((n, [, e]) => n + e.count, 0)} resources of ${extra.length} types`);
    for (const [type, e] of extra) console.log(`    ${type} ×${e.count}${e.classified ? "  (classified by IAC_KINDS)" : ""}`);
  }
  const verdict = failedGate.length === 0 ? "met" : `NOT met by ${failedGate.map((r) => r.name).join(", ")}`;
  console.log(`\nClean-parse gate (.tf >= ${CLEAN_SHARE_GATE * 100}%): ${verdict}`);
  const superset = notSuperset.length === 0 ? "yes" : `NO for ${notSuperset.map((r) => r.name).join(", ")}`;
  console.log(`Model is a superset of infrastructure.ts's resources: ${superset}`);
}
process.exit(failedGate.length === 0 && notSuperset.length === 0 ? 0 : 1);
