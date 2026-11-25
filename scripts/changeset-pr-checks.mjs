/**
 * Changeset checks ci.yml runs on a branch against its base (origin/main).
 *
 * `validate`: runs `changeset status --since=<base>`, except on the Changesets
 * version PR. That PR consumes every changeset and bumps each package.json, so
 * `changeset status` sees changed packages and no changesets and exits 1. The
 * version PR is recognised by its content, not its branch name, because the
 * merge queue's merge_group run has no head_ref: the branch deletes at least
 * one changeset, adds none, and leaves none in the tree.
 *
 * Usage: node scripts/changeset-pr-checks.mjs validate [--base=origin/main]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHANGESET_DIR = ".changeset";

/** A changeset file: `.changeset/<name>.md`, not the directory's README.md. */
export function isChangesetFile(path) {
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === CHANGESET_DIR && parts[1].endsWith(".md") && parts[1] !== "README.md";
}

/**
 * Whether a branch is the Changesets version PR, from the changeset paths it
 * added and deleted against its base and the ones left in its tree. Paths that
 * are not changeset files (README.md, config.json) are ignored.
 * Returns `{ versionPr, reason }`; `reason` is the log line for either verdict.
 */
export function classifyVersionPr({ added, deleted, remaining }) {
  const del = deleted.filter(isChangesetFile);
  const add = added.filter(isChangesetFile);
  const left = remaining.filter(isChangesetFile);
  if (del.length === 0) return { versionPr: false, reason: "deletes no changeset" };
  if (add.length > 0) return { versionPr: false, reason: `adds ${add.length} changeset(s)` };
  if (left.length > 0) return { versionPr: false, reason: `${left.length} changeset(s) remain in the tree` };
  return {
    versionPr: true,
    reason: `consumes ${del.length} changeset(s), adds none and leaves none: the Changesets version PR`,
  };
}

/** Changeset-directory paths the branch changed against `base`, by git diff filter (A, D). */
function diffPaths(base, filter) {
  const out = execFileSync(
    "git",
    ["diff", "--no-renames", `--diff-filter=${filter}`, "--name-only", `${base}...HEAD`, "--", `${CHANGESET_DIR}/*.md`],
    { cwd: ROOT, encoding: "utf-8", windowsHide: true },
  );
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

function remainingPaths() {
  return readdirSync(join(ROOT, CHANGESET_DIR)).map((name) => `${CHANGESET_DIR}/${name}`);
}

function validate(base) {
  const verdict = classifyVersionPr({
    added: diffPaths(base, "A"),
    deleted: diffPaths(base, "D"),
    remaining: remainingPaths(),
  });
  if (verdict.versionPr) {
    console.log(`Skipping changeset status: branch ${verdict.reason}.`);
    return 0;
  }
  console.log(`Running changeset status (branch ${verdict.reason}; not a version PR).`);
  const result = spawnSync("pnpm", ["exec", "changeset", "status", `--since=${base}`], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  const baseArg = rest.find((arg) => arg.startsWith("--base="));
  const base = baseArg ? baseArg.slice("--base=".length) : "origin/main";
  if (command !== "validate") {
    console.error("usage: node scripts/changeset-pr-checks.mjs validate [--base=origin/main]");
    process.exit(2);
  }
  process.exit(validate(base));
}
