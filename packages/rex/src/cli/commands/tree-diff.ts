/**
 * `rex tree-diff` — what changed between two PRD trees.
 *
 * Read-only. Nothing here writes to `.rex/`, and nothing here takes the PRD
 * lock: both sides are snapshots, and a diff that blocked on a running writer
 * would be the one command you cannot use to find out what that writer did.
 *
 * Three comparisons, one command, because they are the same question asked of
 * different sources:
 *
 * - `--from=<ref> --to=<ref>` — two commits. Either side defaults: `--from`
 *   to the anchor branch (`origin/HEAD`, else main/master), `--to` to the
 *   working tree. So bare `rex tree-diff` answers "what has this branch done
 *   to the PRD", which is the common case and needs no flags.
 * - `--against=<dir>` — this checkout's tree against another checkout's, for
 *   two worktrees of the same repository where neither has committed yet.
 *
 * @module rex/cli/commands/tree-diff
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { diffTrees } from "../../core/tree-diff.js";
import { diffProductLayer } from "../../core/map-diff.js";
import type { MapDiff, MapEntry } from "../../core/map-diff.js";
import { renderTreeDiffMarkdown } from "../../core/tree-diff-markdown.js";
import { assertOutsideRexDir } from "./export.js";
import {
  loadTreeAtRef,
  loadTreeFromDir,
  resolveAnchorRef,
  TreeSourceError,
} from "../../core/tree-source.js";
import type { ResolvedTree } from "../../core/tree-source.js";
import type { TreeDiff, DiffEntry, DiffItemRef } from "../../core/tree-diff.js";
import { CLIError } from "../errors.js";
import { result, info, warn } from "../output.js";

/** Label used for the on-disk tree, in both renderings. */
const WORKING_TREE = "working tree";

export async function cmdTreeDiff(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  // Settled before anything is read, so a bad --out fails on the command.
  const out = outPath(dir, flags);
  const { from, to } = await resolveSides(dir, flags);

  const diff = diffTrees(from.items, to.items);
  // The product layer exists only on a v2 tree. When neither side is one,
  // there is no map section at all, so a v1 diff reads as it always has.
  const map =
    from.v2 || to.v2 ? diffProductLayer(from.v2?.product ?? [], to.v2?.product ?? []) : undefined;

  if (isMarkdown(flags)) {
    await emit(renderTreeDiffMarkdown({ fromLabel: from.label, toLabel: to.label, diff, map }), out);
    reportWarnings(from, to);
    return;
  }

  if (isJson(flags)) {
    await emit(JSON.stringify(renderJson(diff, map, from, to), null, 2), out);
    return;
  }

  await renderText(diff, map, from, to, out);
}

/** Write `body` to `out`, or to stdout when there is no file. */
async function emit(body: string, out: string | undefined): Promise<void> {
  const text = body.endsWith("\n") ? body.slice(0, -1) : body;
  if (out === undefined) {
    result(text);
    return;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${text}\n`, "utf-8");
  info(`Wrote ${out}`);
}

/**
 * `--out=<file>`, resolved against the caller's cwd. Refused inside the PRD
 * storage directory, as `rex export` does: nothing is written there that is
 * not a PRD mutation.
 */
function outPath(dir: string, flags: Record<string, string>): string | undefined {
  const raw = value(flags, "out");
  if (raw === undefined) return undefined;
  const path = resolve(raw);
  assertOutsideRexDir(path, dir, "tree-diff report", "./prd-diff.md");
  return path;
}

/** `--format=markdown` (or `md`): the pull-request comment. */
function isMarkdown(flags: Record<string, string>): boolean {
  return flags.format === "markdown" || flags.format === "md";
}

/** `--json` and `--format=json` both select machine-readable output. */
function isJson(flags: Record<string, string>): boolean {
  return flags.json === "true" || flags.format === "json";
}

/**
 * Work out which two trees are being compared, and load them.
 *
 * `--against` is a different axis from `--from`/`--to` — a directory rather
 * than a ref — so combining them is refused rather than given a precedence
 * nobody would remember.
 */
async function resolveSides(
  dir: string,
  flags: Record<string, string>,
): Promise<{ from: ResolvedTree; to: ResolvedTree }> {
  const against = value(flags, "against");
  const fromRef = value(flags, "from");
  const toRef = value(flags, "to");

  if (against !== undefined && (fromRef !== undefined || toRef !== undefined)) {
    throw new CLIError(
      "--against cannot be combined with --from or --to.",
      "--against compares two checkouts on disk; --from/--to compare two commits. Pick one.",
    );
  }

  try {
    if (against !== undefined) {
      const anchorDir = resolve(against);
      const from = await loadTreeFromDir(anchorDir, anchorDir);
      const to = await loadTreeFromDir(dir, WORKING_TREE);
      if (!from.present) {
        throw new CLIError(
          `No PRD tree at ${anchorDir}.`,
          "--against wants another checkout's project directory — the one containing .rex/.",
        );
      }
      return { from, to };
    }

    const baseline = fromRef ?? (await defaultBaseline(dir));
    const from = await loadTreeAtRef(dir, baseline);
    const to =
      toRef === undefined
        ? await loadTreeFromDir(dir, WORKING_TREE)
        : await loadTreeAtRef(dir, toRef);

    return { from, to };
  } catch (err) {
    // The source layer speaks in its own error type so it stays CLI-agnostic;
    // translate once here rather than at every call site above.
    if (err instanceof TreeSourceError) throw new CLIError(err.message, err.suggestion);
    throw err;
  }
}

async function defaultBaseline(dir: string): Promise<string> {
  const anchor = await resolveAnchorRef(dir);
  if (anchor !== null) return anchor;
  throw new CLIError(
    "Could not work out a default branch to compare against.",
    "Name one explicitly: rex tree-diff --from=<ref> [--to=<ref>], or compare two checkouts with --against=<dir>.",
  );
}

/** A flag's value, or undefined when absent or given without one. */
function value(flags: Record<string, string>, name: string): string | undefined {
  const raw = flags[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "true") {
    throw new CLIError(
      `--${name} needs a value.`,
      `Write it as --${name}=<value>; the space-separated form is not supported.`,
    );
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The machine-readable payload.
 *
 * `sources` carries what each side was and whether it had a tree at all, so a
 * consumer can tell "the baseline predates the PRD" from "the baseline was
 * empty" without re-running git.
 */
function renderJson(diff: TreeDiff, map: MapDiff | undefined, from: ResolvedTree, to: ResolvedTree) {
  return {
    sources: {
      from: { label: from.label, present: from.present, items: diff.totals.from },
      to: { label: to.label, present: to.present, items: diff.totals.to },
    },
    identical: diff.identical && (map?.identical ?? true),
    counts: diff.counts,
    added: diff.added,
    changed: diff.changed,
    completed: diff.completed,
    moved: diff.moved,
    removed: diff.removed,
    ...(map ? { map } : {}),
    warnings: [...from.warnings, ...to.warnings].map((w) => ({
      path: w.path,
      message: w.message,
    })),
  };
}

async function renderText(
  diff: TreeDiff,
  map: MapDiff | undefined,
  from: ResolvedTree,
  to: ResolvedTree,
  out: string | undefined,
): Promise<void> {
  const lines: string[] = [`${from.label} → ${to.label}`];

  if (map && !map.identical) {
    lines.push(
      "",
      `Product map: ${map.counts.added} added · ${map.counts.modified} modified · ${map.counts.retired} retired`,
    );
    section(lines, "Capabilities added", map.added, describeMap);
    section(lines, "Capabilities modified", map.modified, (e) => {
      const details = e.fields.map((f) => `      ${f.field}: ${show(f.from)} → ${show(f.to)}`);
      if (e.criteria) {
        const c = e.criteria;
        details.push(`      capability criteria: +${c.added.length} -${c.removed.length} ~${c.changed.length}`);
      }
      return [describeMap(e), ...details].join("\n");
    });
    section(lines, "Capabilities retired", map.retired, describeMap);
  }

  if (diff.identical) {
    // Capability changes printed above are differences; say which layer has none.
    lines.push("", map && !map.identical ? "No changes to the change layer." : "No differences.");
    await emit(lines.join("\n"), out);
    reportWarnings(from, to);
    return;
  }

  section(lines, "Added", diff.added, (e) => describe(e));
  section(lines, "Completed", diff.completed, (e) => describe(e));
  section(lines, "Changed", diff.changed, (e) =>
    `${describe(e)}\n${e.fields
      .map((f) => `      ${f.field}: ${show(f.from)} → ${show(f.to)}`)
      .join("\n")}`,
  );
  section(lines, "Moved", diff.moved, (e) =>
    `${describe(e)}\n      from: ${path(e.fromAncestors) || "(root)"}`,
  );
  section(lines, "Removed", diff.removed, (e) => describe(e));

  lines.push(
    "",
    `${diff.counts.added} added · ${diff.counts.changed} changed · ` +
      `${diff.counts.completed} completed · ${diff.counts.moved} moved · ` +
      `${diff.counts.removed} removed`,
  );

  await emit(lines.join("\n"), out);
  reportWarnings(from, to);
}

function section<T>(
  lines: string[],
  heading: string,
  entries: T[],
  render: (entry: T) => string,
): void {
  if (entries.length === 0) return;
  lines.push("", `${heading} (${entries.length})`);
  for (const e of entries) lines.push(`  ${render(e)}`);
}

/** `<title> [<level> <short-id>]` on the first line, its location beneath. */
function describe(entry: DiffEntry): string {
  const where = path(entry.ancestors);
  const head = `${entry.title}  [${entry.level} ${entry.id.slice(0, 8)}]`;
  return where ? `${head}\n      in: ${where}` : head;
}

/** `<title>  [<type> <id>]` with the areas and capabilities it sits under beneath. */
function describeMap(entry: MapEntry): string {
  const head = `${entry.title}  [${entry.type} ${entry.displayId ?? entry.id.slice(0, 8)}]`;
  return entry.ancestors.length ? `${head}\n      in: ${entry.ancestors.join(" › ")}` : head;
}

function path(ancestors: DiffItemRef[]): string {
  return ancestors.map((a) => a.title).join(" › ");
}

function show(v: string | null): string {
  if (v === null) return "(none)";
  const collapsed = v.replace(/\s+/g, " ").trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}…` : collapsed;
}

/**
 * Surface parser warnings from either side.
 *
 * A malformed item file is the one way a diff can be quietly wrong — the item
 * is simply missing from that side, so it reads as added or removed. Saying
 * so costs two lines and is the difference between a puzzling diff and an
 * explained one.
 *
 * The "no PRD tree at this source" notice is keyed off `present`, not off
 * warning text: `loadTreeFromDir` explains an absent tree with a
 * "Tree root directory does not exist" parser warning, but `loadTreeAtRef`
 * reports the very same condition — a ref that predates the PRD — as
 * `present: false` with an empty `warnings` array, since there is no on-disk
 * tree for the parser to have warned about. Keying off the warning text alone
 * left that case silent.
 */
function reportWarnings(from: ResolvedTree, to: ResolvedTree): void {
  for (const [side, tree] of [[from.label, from], [to.label, to]] as const) {
    if (!tree.present) {
      info(`${side}: no PRD tree at this source.`);
    }
    for (const w of tree.warnings) {
      if (w.message === "Tree root directory does not exist") continue;
      warn(`${side}: ${w.path} — ${w.message}`);
    }
  }
}
