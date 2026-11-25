/**
 * Pure changeset checks for ci.yml. The workflow step runs `git diff` against
 * origin/main itself and hands the path lists in through environment variables
 * (newline-separated), so this script spawns nothing.
 *
 * Each command prints one reason line and exits 0 when its answer is yes, 1
 * when it is no, 2 on a usage error.
 *
 * `is-version-pr` (CHANGESET_ADDED, CHANGESET_DELETED): whether the branch is
 * the Changesets version PR. That PR consumes every changeset and bumps each
 * package.json, so `changeset status` sees changed packages and no changesets
 * and exits 1. It is recognised by content, not branch name, because the merge
 * queue's merge_group run has no head_ref: the branch deletes at least one
 * changeset, adds none, and leaves none in the tree.
 *
 * Usage: CHANGESET_ADDED=… CHANGESET_DELETED=… node scripts/changeset-pr-checks.mjs is-version-pr
 */

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

/** Newline-separated paths from an environment variable; unset is empty. */
function envPaths(name) {
  return (process.env[name] ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function remainingPaths() {
  return readdirSync(join(ROOT, CHANGESET_DIR)).map((name) => `${CHANGESET_DIR}/${name}`);
}

/** CLI commands: each returns `{ yes, line }`; exit 0 for yes, 1 for no. */
const COMMANDS = {
  "is-version-pr": () => {
    const { versionPr, reason } = classifyVersionPr({
      added: envPaths("CHANGESET_ADDED"),
      deleted: envPaths("CHANGESET_DELETED"),
      remaining: remainingPaths(),
    });
    return { yes: versionPr, line: `Branch ${reason}.` };
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = COMMANDS[process.argv[2]];
  if (!run) {
    console.error(`usage: node scripts/changeset-pr-checks.mjs <${Object.keys(COMMANDS).join("|")}>`);
    process.exit(2);
  }
  const { yes, line } = run();
  console.log(line);
  process.exit(yes ? 0 : 1);
}
