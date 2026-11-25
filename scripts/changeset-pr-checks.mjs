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
 * `no-changeset-edits` (CHANGESET_EDITED, the output of
 * `git diff --name-status --diff-filter=MR`): whether the branch leaves every
 * changeset already on main untouched. A release consumes and deletes those
 * files, so an edit to one is lost or conflicts; a PR adds its own instead.
 * Answers no (exit 1) when it modifies or renames one, so a crash fails too.
 *
 * Usage: CHANGESET_ADDED=… CHANGESET_DELETED=… node scripts/changeset-pr-checks.mjs is-version-pr
 *        CHANGESET_EDITED=… node scripts/changeset-pr-checks.mjs no-changeset-edits
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

/**
 * The changesets on main a branch edits, from `git diff --name-status
 * --diff-filter=MR` lines (`M\t<path>` or `R<score>\t<old>\t<new>`). A rename
 * is reported by its old path, the file on main. Non-changeset paths
 * (README.md) are ignored. Returns `{ edited, message }`; `message` is the
 * failure text, empty when nothing is edited.
 */
export function findEditedChangesets(statusLines) {
  const edited = [];
  for (const line of statusLines) {
    const [status, path, renamedTo] = line.split("\t");
    if (!path || !isChangesetFile(path)) continue;
    if (status === "M") edited.push(path);
    else if (status.startsWith("R")) edited.push(`${path} (renamed to ${renamedTo})`);
  }
  if (edited.length === 0) return { edited, message: "" };
  const message = [
    `This branch edits ${edited.length} changeset(s) already on main:`,
    ...edited.map((file) => `  ${file}`),
    "Restore them and add a new changeset instead (pnpm changeset): a changeset already on main may be consumed by the next release, which deletes it and loses the edit.",
  ].join("\n");
  return { edited, message };
}

/** Newline-separated lines from an environment variable; unset is empty. */
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
  "no-changeset-edits": () => {
    const { edited, message } = findEditedChangesets(envPaths("CHANGESET_EDITED"));
    return { yes: edited.length === 0, line: message || "Branch edits no changeset already on main." };
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
