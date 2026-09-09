/**
 * `rex export` — write the PRD out to a single file.
 *
 * Two very different renderings share this command, because they share the
 * question an operator is asking ("give me the PRD as a file") and the
 * arguments that answer it — `--out`, the in-tree guard, and `--item`, which
 * both renderings scope with through the same resolver:
 *
 * - **bundle** (default) — the portable JSON transport artifact. It goes to an
 *   operator-chosen path outside `.rex/prd_tree/` and nothing in rex ever
 *   reads it as storage. See `../../core/prd-bundle.ts` for the format, the
 *   carve-out rationale, and what `--item` scoping pulls in.
 * - **narrative** (`--format=narrative`) — prose Markdown for a stakeholder,
 *   with no ids, slugs or status codes. Deliberately one-way; the bundle is
 *   the round-trip surface. See `../../core/prd-narrative.ts`.
 *
 * Not to be confused with `ndx export`, which publishes the static dashboard.
 */

import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  resolveStore,
  PRD_TREE_DIRNAME,
  resolveGitBranch,
  slugifyTitle,
  resolveSiblingSlugs,
} from "../../store/index.js";
import { atomicWrite, atomicWriteJSON } from "../../store/atomic-write.js";
import { captureGitCommitHash } from "../../core/git-utils.js";
import { buildBundle, countItems, scopeItems } from "../../core/prd-bundle.js";
import type { ScopedSelection } from "../../core/prd-bundle.js";
import { renderNarrative } from "../../core/prd-narrative.js";
import type { PRDDocument, PRDItem } from "../../schema/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info, warn } from "../output.js";

/** Renderings `--format` selects between. `json` is bundle output with a machine-readable report. */
const FORMATS = ["bundle", "json", "narrative"] as const;
type ExportFormat = (typeof FORMATS)[number];

function parseFormat(raw: string | undefined): ExportFormat {
  if (raw === undefined || raw === "true") return "bundle";
  if ((FORMATS as readonly string[]).includes(raw)) return raw as ExportFormat;
  throw new CLIError(
    `Unknown --format "${raw}".`,
    `Valid formats: ${FORMATS.join(", ")}.`,
  );
}

/** An item plus its path in `.rex/prd_tree/`, so an ambiguous match can name the candidates. */
export interface ItemRefMatch {
  item: PRDItem;
  /** Slug path relative to the tree root, e.g. `prd-storage/portable-bundle`. */
  path: string;
}

/**
 * Pair every item with the folder-tree path it is actually stored at.
 *
 * `resolveSiblingSlugs` is the authoritative resolver and has to be called per
 * sibling set, because whether a slug carries its `-{id6}` suffix depends on
 * the item's siblings rather than on the item. Slugifying each title
 * independently — the obvious shortcut — produces the wrong name for exactly
 * the items an operator is most likely to be scoping to by hand, since the
 * suffix only appears where two titles collide.
 */
function slugPaths(items: PRDItem[], prefix = ""): ItemRefMatch[] {
  const slugs = resolveSiblingSlugs(items);
  const matches: ItemRefMatch[] = [];

  for (const item of items) {
    const path = `${prefix}${slugs.get(item.id) ?? slugifyTitle(item.title)}`;
    matches.push({ item, path });
    if (item.children?.length) matches.push(...slugPaths(item.children, `${path}/`));
  }

  return matches;
}

/**
 * Resolve an `--item` reference to the items it could mean.
 *
 * Five spellings are accepted, tried in order of decreasing precision and
 * stopping at the first that matches anything: the item id, its exact title,
 * its folder path or trailing path segment, the bare slug its title would
 * produce, and an id prefix recovered from a directory name's `-{id6}` suffix.
 * Slug matching exists because that is what an operator has in front of them —
 * they found the item by browsing `.rex/prd_tree/`, and retyping a title from
 * a truncated directory name is busywork.
 *
 * The precision order is what keeps the loose spellings safe: an id is
 * unambiguous, a title is usually unique, and a slug is a lossy projection of
 * a title, so a slug match can never displace an exact title match.
 *
 * Returns every match rather than the first, so a caller can refuse an
 * ambiguous reference instead of silently exporting whichever item the walk
 * happened to reach first.
 *
 * Shared rather than private so scoped bundle export can resolve `--item`
 * identically — one flag with two meanings would be worse than none.
 */
export function resolveItemRef(items: PRDItem[], ref: string): ItemRefMatch[] {
  const all = slugPaths(items);

  const byId = all.filter((match) => match.item.id === ref);
  if (byId.length > 0) return byId;

  const normalised = ref.trim().toLowerCase();
  const byTitle = all.filter((match) => match.item.title.trim().toLowerCase() === normalised);
  if (byTitle.length > 0) return byTitle;

  const wanted = normalised.replace(/^\/+|\/+$/g, "");
  const byPath = all.filter(
    (match) => match.path === wanted || match.path.endsWith(`/${wanted}`),
  );
  if (byPath.length > 0) return byPath;

  const slug = slugifyTitle(ref);
  const bySlug = all.filter((match) => slugifyTitle(match.item.title) === slug);
  if (bySlug.length > 0) return bySlug;

  // Last resort: recover an id from a directory name's `-{id6}` suffix. The
  // suffix is the first six hex digits of the item id, added when a title
  // collides with a sibling's — and added unconditionally by trees written
  // before that rule narrowed. Either way the readable half of the directory
  // name may not be what the current slug rule would produce, so the id half
  // is the only part that still resolves. It also makes a bare id prefix
  // (`--item=53b3e7`) work, which is what someone reading a directory listing
  // is most likely to type.
  const idPrefix = /(?:^|-)([0-9a-f]{6,})$/i.exec(normalised)?.[1];
  if (idPrefix === undefined) return [];
  return all.filter((match) => match.item.id.toLowerCase().startsWith(idPrefix.toLowerCase()));
}

/**
 * Reject an output path inside the folder tree.
 *
 * An export written into `.rex/prd_tree/` would sit in the one directory the
 * PRD invariant reserves for PRD markdown, where the next tree write would
 * treat it as junk (or, worse, a future reader would treat it as storage).
 * The hazard is sharper for a narrative document than for a bundle: it *is*
 * markdown, so a stray `index.md` there could be parsed as an item.
 */
function assertOutsideTree(outPath: string, dir: string, noun: string, example: string): void {
  const treeRoot = join(dir, REX_DIR, PRD_TREE_DIRNAME);
  const rel = relative(treeRoot, outPath);
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (inside) {
    throw new CLIError(
      `Refusing to write a ${noun} inside ${REX_DIR}/${PRD_TREE_DIRNAME}/.`,
      `The ${noun} is not PRD storage — pick a path outside the PRD tree, e.g. --out=${example}`,
    );
  }
}

export async function cmdExport(dir: string, flags: Record<string, string>): Promise<void> {
  // Argument shape is settled before anything is read from disk, so a
  // malformed command fails on the command rather than on the project.
  const format = parseFormat(flags.format);
  const narrative = format === "narrative";
  const scope = readScope(flags);

  const out = flags.out;
  if (!out || out === "true") {
    throw new CLIError(
      "Missing --out path.",
      narrative
        ? "Usage: rex export --format=narrative --out=<path.md> [dir]"
        : "Usage: rex export --out=<path.json> [dir]",
    );
  }

  // Resolved against the caller's cwd, not the project dir: an operator typing
  // `--out=bundle.json` means "here", the same as every other CLI.
  const outPath = resolve(out);
  assertOutsideTree(
    outPath,
    dir,
    narrative ? "narrative document" : "bundle",
    narrative ? "./prd.md" : "./prd-bundle.json",
  );

  const store = await resolveStore(join(dir, REX_DIR));
  const doc = await store.loadDocument();

  // Resolution happens before any write, so an unknown --item leaves no file
  // behind — an operator who mistyped a slug must not be left holding a
  // whole-PRD bundle named after the item they meant to scope to.
  const target = scope === undefined ? undefined : resolveScope(doc, scope);

  if (narrative) {
    await writeNarrative(doc, outPath, target, flags);
    return;
  }

  const selection = target === undefined ? undefined : scopeItems(doc.items, target.item.id);

  const bundle = buildBundle(
    { ...doc, items: selection?.items ?? doc.items },
    {
      branch: resolveGitBranch(dir),
      commit: await captureGitCommitHash(dir),
    },
  );

  await mkdir(dirname(outPath), { recursive: true });
  await atomicWriteJSON(outPath, bundle);

  const items = countItems(bundle.items);

  if (format === "json") {
    result(
      JSON.stringify(
        {
          out: outPath,
          items,
          schema: bundle.schema,
          exportedAt: bundle.exportedAt,
          ...(selection && target
            ? { scope: scopeReport(selection, target) }
            : {}),
        },
        null,
        2,
      ),
    );
    return;
  }

  result(`Exported ${items} item${items === 1 ? "" : "s"} to ${outPath}`);
  if (selection && target) reportScope(selection, target);
  info(`Import elsewhere with: rex import-bundle --in=${out}`);
}

/** Machine-readable counterpart of {@link reportScope}. */
function scopeReport(
  selection: ScopedSelection,
  target: ItemRefMatch,
): Record<string, unknown> {
  return {
    item: { id: target.item.id, title: target.item.title, path: target.path },
    requested: selection.counts.requested,
    dependencies: selection.counts.dependency,
    ancestors: selection.counts.ancestor,
    droppedEdges: selection.droppedEdges,
  };
}

/**
 * Say what the scope actually cost.
 *
 * A closure can reach well past the item an operator named — a single task
 * blocked across two epics drags in both, and their containers. Reporting one
 * total would let a "scoped" export quietly grow to half the PRD without
 * anyone noticing, so the requested subtree and the closure's contribution are
 * counted separately.
 */
function reportScope(selection: ScopedSelection, target: ItemRefMatch): void {
  const { requested, dependency, ancestor } = selection.counts;

  info(
    `Scoped to "${target.item.title}": ${requested} requested item${requested === 1 ? "" : "s"} ` +
      `(the item and everything beneath it)`,
  );

  if (dependency > 0 || ancestor > 0) {
    const pulled = [
      dependency > 0 ? `${dependency} blocking item${dependency === 1 ? "" : "s"}` : null,
      ancestor > 0 ? `${ancestor} ancestor container${ancestor === 1 ? "" : "s"}` : null,
    ].filter((part): part is string => part !== null);
    info(`Closure pulled in ${pulled.join(" and ")} to keep dependencies and placement intact`);
  }

  if (selection.droppedEdges.length > 0) {
    warn(
      `Dropped ${selection.droppedEdges.length} blockedBy edge${selection.droppedEdges.length === 1 ? "" : "s"} ` +
        `pointing at items that no longer exist in this PRD:`,
    );
    for (const edge of selection.droppedEdges) {
      warn(`  ${edge.title} (${edge.id}) → ${edge.blockedBy}`);
    }
  }
}

/**
 * Resolve `--item` to exactly one item, or fail.
 *
 * Shared by both renderings so one flag keeps one meaning. Refusing an
 * ambiguous reference — rather than taking the first match — is the point:
 * silently exporting whichever of two same-titled items the walk reached first
 * would be indistinguishable from success.
 */
function resolveScope(doc: PRDDocument, scope: string): ItemRefMatch {
  const matches = resolveItemRef(doc.items, scope);

  if (matches.length === 0) {
    throw new CLIError(
      `No PRD item matches --item="${scope}".`,
      "Pass an item id, its exact title, or its folder slug from .rex/prd_tree/. Run 'rex status' to list items.",
    );
  }

  if (matches.length > 1) {
    throw new CLIError(
      `--item="${scope}" matches ${matches.length} items.`,
      `Narrow it with a full path or an id:\n${matches
        .map((match) => `  ${match.path}  (${match.item.id})`)
        .join("\n")}`,
    );
  }

  return matches[0];
}

/**
 * The `--item` value, or undefined when the flag was absent.
 *
 * A valueless `--item` is an error rather than a no-op. The parser turns a
 * bare flag into the string `"true"`, so `--item my-epic` (space-separated)
 * arrives here as `"true"` with `my-epic` swallowed as the project directory.
 * Silently rendering the whole PRD at that point would hand the operator a
 * thousand items when they asked for one, and they would have no reason to
 * look twice at a document that was produced without complaint.
 */
function readScope(flags: Record<string, string>): string | undefined {
  const raw = flags.item;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "true") {
    throw new CLIError(
      "--item needs a value.",
      "Write it as --item=<id-or-slug>; the space-separated form is not supported.",
    );
  }
  return trimmed;
}

/**
 * Render and write the prose document.
 *
 * The closing `info` line is not decoration: narrative output is lossy and
 * one-way, and the moment to say so is when someone has just produced one and
 * might be about to treat it as a backup.
 */
async function writeNarrative(
  doc: PRDDocument,
  outPath: string,
  target: ItemRefMatch | undefined,
  flags: Record<string, string>,
): Promise<void> {
  const { markdown, items } = renderNarrative(doc, {
    rootId: target?.item.id,
    includeCompleted: flags["include-completed"] === "true",
  });

  await mkdir(dirname(outPath), { recursive: true });
  await atomicWrite(outPath, markdown);

  result(`Wrote a narrative document covering ${items} item${items === 1 ? "" : "s"} to ${outPath}`);
  info("Narrative output is one-way — use 'rex export --out=<path.json>' for a re-importable bundle.");
}
