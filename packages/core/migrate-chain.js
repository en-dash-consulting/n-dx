/**
 * `ndx migrate [dir]` with neither `--plan` nor `--apply`: bring a project to
 * the current storage in one command, by running every migration link it
 * still needs, in order.
 *
 * Each link moves the project from one version to the next and says, from the
 * files alone, whether it is needed. A link already done is reported and
 * skipped, so the chain is safe to re-run after a failure: it resumes at the
 * first link still needed. A later schema step is one more entry in
 * {@link MIGRATION_LINKS}.
 *
 * | Link            | From                    | To                  | Runs                                   |
 * |-----------------|-------------------------|---------------------|----------------------------------------|
 * | `layout`        | legacy (`.rex/`, …)     | `.ndx/`             | `ndx migrate-layout`                   |
 * | `prd-tree`      | `prd.md` / `prd.json`   | `rex/v1` folder tree| `rex migrate-to-folder-tree`           |
 * | `schema-v2`     | `rex/v1` (`prd_tree/`)  | `rex/v2` (`product/`)| `rex migrate --plan`, then `--apply`  |
 *
 * `--dry-run` rehearses each link that can rehearse (layout prints its moves,
 * schema writes the plan file and rehearses the apply) and stops before the
 * first that cannot, since the links after it read what it would have
 * written.
 *
 * Orchestration tier: rex is reached by spawning it, through the `run` and
 * `runMigrateLayout` the caller injects (see {@link MigrateChainDeps}). The
 * folder names read here are rex's on-disk contract, not imports.
 *
 * @module n-dx/migrate-chain
 */

import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

import { resolveLayout } from "./layout.js";

/** rex's v1 folder tree, under the rex directory (rex `store/paths.ts`). */
const PRD_TREE_DIRNAME = "prd_tree";
/** rex's v2 product layer, under the rex directory (rex `store/prd-model-reader.ts`). */
const PRODUCT_DIRNAME = "product";
/** rex's flat v1 files, read by `rex migrate-to-folder-tree`. */
const FLAT_PRD_FILE = /^(prd\.md|prd\.json|prd_.+_\d{4}-\d{2}-\d{2}\.md)$/;

/**
 * rex's switch for its v1 deprecation notice (rex `cli/legacy-layout-notice.ts`).
 * The chain turns it off for the rex commands it spawns: telling the operator
 * to run `ndx migrate` while it runs is noise.
 */
const LEGACY_NOTICE_ENV = "NDX_LEGACY_NOTICE";

/** Flags each link forwards, by prefix; a value flag arrives in its `--flag=value` form. */
const LAYOUT_FLAGS = ["--dry-run", "--no-commit"];
const PLAN_FLAGS = ["--rules-only", "--model=", "--cut-at=", "--out="];

/**
 * Spawn helpers, injected by cli.js so this module imports no package.
 *
 * @typedef {object} MigrateChainDeps
 * @property {(script: string, args: string[]) => Promise<number>} run  Spawn a tool; resolves to its exit code.
 * @property {Record<string, string>} tools  Tool script paths (`tools.rex`).
 * @property {(dir: string, flags: string[]) => Promise<number>} migrateLayout  The layout migration, already bound to its own deps.
 */

/**
 * One versioned step.
 *
 * @typedef {object} MigrationLink
 * @property {string} id
 * @property {string} from  Version or layout the link starts from.
 * @property {string} to    Version or layout it leaves.
 * @property {(root: string) => boolean} needed  Whether the project at `root` is still at `from`.
 * @property {boolean} rehearses  Whether `--dry-run` can rehearse it without writing what later links read.
 * @property {(root: string, flags: string[], deps: MigrateChainDeps) => Promise<number>} run
 */

/** @param {string} root */
function rexDirOf(root) {
  return resolveLayout(root).rexDir;
}

/** @param {string} root */
function hasV2Tree(root) {
  return existsSync(join(rexDirOf(root), PRODUCT_DIRNAME));
}

/** @param {string} root */
function hasV1Tree(root) {
  return existsSync(join(rexDirOf(root), PRD_TREE_DIRNAME));
}

/** @param {string} root */
function hasFlatPrd(root) {
  const rexDir = rexDirOf(root);
  if (!existsSync(rexDir)) return false;
  return readdirSync(rexDir).some((name) => FLAT_PRD_FILE.test(name));
}

/** @param {string[]} flags @param {string[]} allowed */
function pick(flags, allowed) {
  return flags.filter((flag) => allowed.some((a) => (a.endsWith("=") ? flag.startsWith(a) : flag === a)));
}

/** @type {readonly MigrationLink[]} */
export const MIGRATION_LINKS = [
  {
    id: "layout",
    from: "legacy layout",
    to: ".ndx/ layout",
    needed: (root) => resolveLayout(root).mode === "legacy",
    rehearses: true,
    run: (root, flags, deps) => deps.migrateLayout(root, pick(flags, LAYOUT_FLAGS)),
  },
  {
    id: "prd-tree",
    from: "prd.md / prd.json",
    to: "rex/v1 folder tree",
    needed: (root) => !hasV2Tree(root) && !hasV1Tree(root) && hasFlatPrd(root),
    rehearses: false,
    run: (root, _flags, deps) => deps.run(deps.tools.rex, ["migrate-to-folder-tree", root]),
  },
  {
    id: "schema-v2",
    from: "rex/v1",
    to: "rex/v2",
    needed: (root) => !hasV2Tree(root) && hasV1Tree(root),
    rehearses: true,
    run: async (root, flags, deps) => {
      const planFlags = pick(flags, PLAN_FLAGS);
      const planned = await deps.run(deps.tools.rex, ["migrate", "--plan", ...planFlags, root]);
      if (planned !== 0) return planned;
      const out = planFlags.find((flag) => flag.startsWith("--out="));
      const applyFlags = [
        ...(out ? [`--plan=${out.slice("--out=".length)}`] : []),
        ...pick(flags, ["--dry-run"]),
      ];
      return deps.run(deps.tools.rex, ["migrate", "--apply", ...applyFlags, root]);
    },
  },
];

/**
 * Run every link the project at `dir` still needs.
 *
 * @param {string} dir
 * @param {string[]} flags  `--dry-run`, `--no-commit`, and the plan flags (`--rules-only`, `--model=`, `--cut-at=`, `--out=`).
 * @param {MigrateChainDeps} deps
 * @param {readonly MigrationLink[]} [links]
 * @returns {Promise<number>} Exit code: the first failing link's, else 0.
 */
export async function runMigrateChain(dir, flags, deps, links = MIGRATION_LINKS) {
  const root = resolve(dir);
  const unknown = flags.filter((flag) => pick([flag], [...LAYOUT_FLAGS, ...PLAN_FLAGS]).length === 0);
  if (unknown.length > 0) {
    // A dropped typo would change what runs: `--rule-only` would pay for every model pass.
    console.error(`Error: ndx migrate does not take ${unknown.join(", ")}.`);
    console.error(`Hint: The steps take ${[...LAYOUT_FLAGS, ...PLAN_FLAGS].map((f) => (f.endsWith("=") ? `${f}<value>` : f)).join(", ")}.`);
    return 1;
  }
  const dryRun = flags.includes("--dry-run");
  // Spawned children inherit the environment; this process exits after the chain.
  process.env[LEGACY_NOTICE_ENV] = "off";
  let ran = 0;
  for (const [index, link] of links.entries()) {
    const label = `[${index + 1}/${links.length}] ${link.id}: ${link.from} → ${link.to}`;
    if (!link.needed(root)) {
      console.log(`${label} — already done`);
      continue;
    }
    if (dryRun && !link.rehearses) {
      console.log(`${label} — would run; --dry-run stops here, because the steps after it read what it writes`);
      return 0;
    }
    console.log(`${label}${dryRun ? " (dry run)" : ""}`);
    const code = await link.run(root, flags, deps);
    if (code !== 0) {
      console.error(`Error: migration step ${link.id} failed (exit ${code}); the steps after it did not run.`);
      console.error("Hint: Fix the cause and run 'ndx migrate' again: steps already done are skipped.");
      return code;
    }
    ran++;
  }
  if (ran === 0) console.log(`Nothing to migrate in ${root}: the project is on the current layout and schema.`);
  return 0;
}
