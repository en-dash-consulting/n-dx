/**
 * Post-merge structural validation of the PRD folder tree.
 *
 * A git merge of `.rex/prd_tree/` can leave corruption no ordinary rex code
 * path produces — both branches adding the same item at different paths,
 * conflict resolutions deleting an `index.md` but not its directory, files
 * landing at the wrong depth, references to items the other branch deleted,
 * or unresolved conflict markers. None of it errors on its own: the parser
 * tolerates what it can and the rest survives silently.
 *
 * This module scans the RAW tree (filesystem walk + lightweight frontmatter
 * reads), deliberately not the store: a corrupt tree is exactly the input the
 * parser may normalize, choke on, or silently repair, and the point here is
 * to see the corruption, not the parser's best guess.
 *
 * Corruption classes and their repair policy:
 *
 * | class                      | meaning                                        | repair |
 * |----------------------------|------------------------------------------------|--------|
 * | conflict-markers           | unresolved `<<<<<<<` blocks in a file          | refused — a human owns conflict resolution |
 * | duplicate-id               | one item id at two or more paths               | refused — which copy wins is ambiguous |
 * | orphaned-directory         | a directory with no `index.md`                 | removed when empty of items; refused when items remain inside |
 * | level-mismatch             | frontmatter `level` disagrees with nesting     | rewritten to the depth-implied level |
 * | dangling-blocked-by        | `blockedBy` id that exists nowhere in the tree | dangling ids dropped, valid ones kept |
 * | children-table-out-of-sync | `## Children` disagrees with the directory     | table rewritten from the directory |
 *
 * `children-table-out-of-sync` is the one class here that is not corruption.
 * The table is informational — the parser walks the filesystem and never reads
 * it — so an item missing from the table is still loaded, still saved, and the
 * next full-tree save rewrites the table complete. It is reported because it
 * reached `main` unnoticed and was repaired by hand twice (#394, #395), and
 * because a stale table misleads every human and agent reading the tree as
 * documentation. It is deliberately repairable, so the CI gate added in #396
 * reports it as advisory rather than blocking the merge.
 *
 * Do not confuse it with the shape that does destroy items: a directory whose
 * `index.md` is missing cannot be parsed as an item at all, so a full save
 * collects everything inside it as unreachable. That is `orphaned-directory`,
 * and it is what 47062ab3 restored five files from.
 *
 * @see packages/rex/tests/integration/children-table-omission.test.ts — the
 *      fixture that settled cosmetic-vs-destructive against the real store.
 *
 * @module rex/core/post-merge-validate
 */

import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// ── Public types ──────────────────────────────────────────────────────────────

export type PostMergeIssueClass =
  | "conflict-markers"
  | "duplicate-id"
  | "orphaned-directory"
  | "level-mismatch"
  | "dangling-blocked-by"
  | "children-table-out-of-sync";

export interface PostMergeIssue {
  class: PostMergeIssueClass;
  /** Path relative to the tree root (the directory itself for orphaned dirs). */
  path: string;
  /** Item id, where one could be read. */
  itemId?: string;
  /** Human-readable description including everything needed to act. */
  message: string;
  /** Whether `repairPostMergeIssues` can fix this deterministically. */
  repairable: boolean;
  /** Repair payload — interpretation depends on the class. */
  detail?: string[];
}

export interface PostMergeReport {
  issues: PostMergeIssue[];
  /** How many markdown files the scan covered. */
  scannedFiles: number;
}

// ── Detection ─────────────────────────────────────────────────────────────────

interface ScannedEntry {
  /** Path relative to treeRoot of the markdown file. */
  relPath: string;
  /** Item depth: 1 for a root-level item, matching the parser's convention. */
  depth: number;
  id?: string;
  level?: string;
  blockedBy: string[];
  hasConflictMarkers: boolean;
  /**
   * A legacy single-child compaction shim. The parser handles these on a
   * separate path and never lists them as leaf children, so neither does the
   * Children-table census.
   */
  isParentShim: boolean;
  /**
   * Link targets read out of this file's `## Children` table, in table order,
   * normalised to the directory-relative form the serializer writes
   * (`child.md` or `child/index.md`). `undefined` when the file has no
   * Children section at all — which is the correct state for a leaf, and drift
   * only for an item that has children on disk.
   */
  childLinks?: string[];
}

const CONFLICT_MARKERS = /^(<{7} |={7}$|>{7} )/m;
const LEVELS_BY_DEPTH: Record<number, string> = { 1: "epic", 2: "feature", 3: "task" };
const VALID_LEVELS = new Set(["epic", "feature", "task", "subtask"]);

/** The level nesting depth implies: epic/feature/task, then subtask all the way down. */
function depthImpliedLevel(depth: number): string {
  return LEVELS_BY_DEPTH[depth] ?? "subtask";
}

/**
 * Scan the tree at `treeRoot` for post-merge corruption.
 * A missing tree root yields an empty report — nothing to validate is not an error.
 */
export async function detectPostMergeIssues(treeRoot: string): Promise<PostMergeReport> {
  const entries: ScannedEntry[] = [];
  const issues: PostMergeIssue[] = [];

  await walk(treeRoot, treeRoot, entries, issues);

  // Per-file classes were collected during the walk; cross-file classes need
  // the complete id census.
  const byId = new Map<string, ScannedEntry[]>();
  for (const entry of entries) {
    if (!entry.id) continue;
    const list = byId.get(entry.id) ?? [];
    list.push(entry);
    byId.set(entry.id, list);
  }

  for (const [id, holders] of byId) {
    if (holders.length < 2) continue;
    issues.push({
      class: "duplicate-id",
      path: holders[0].relPath,
      itemId: id,
      message:
        `id ${id} appears at ${holders.length} paths: ${holders.map((h) => h.relPath).join(", ")} — ` +
        `two branches created or moved the same item; keep one and delete the rest by hand`,
      repairable: false,
    });
  }

  for (const entry of entries) {
    const dangling = entry.blockedBy.filter((ref) => !byId.has(ref));
    if (dangling.length === 0) continue;
    issues.push({
      class: "dangling-blocked-by",
      path: entry.relPath,
      itemId: entry.id,
      message: `blockedBy references item${dangling.length === 1 ? "" : "s"} that exist nowhere in the tree: ${dangling.join(", ")}`,
      repairable: true,
      detail: dangling,
    });
  }

  issues.push(...detectChildrenTableDrift(entries));

  issues.sort((a, b) => a.path.localeCompare(b.path) || a.class.localeCompare(b.class));
  return { issues, scannedFiles: entries.length };
}

async function walk(
  dir: string,
  treeRoot: string,
  entries: ScannedEntry[],
  issues: PostMergeIssue[],
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // no tree — nothing to validate
  }

  const isRoot = dir === treeRoot;
  if (!isRoot && !names.includes("index.md")) {
    const itemCount = await countMarkdownInside(dir);
    const relPath = toRel(treeRoot, dir);
    issues.push({
      class: "orphaned-directory",
      path: relPath,
      message:
        itemCount === 0
          ? `directory has no index.md and no items inside — an empty husk left by the merge`
          : `directory has no index.md but still contains ${itemCount} item file${itemCount === 1 ? "" : "s"} — ` +
            `restore its index.md (git checkout) or re-home the children before deleting`,
      repairable: itemCount === 0,
    });
    if (itemCount === 0) return; // nothing inside worth scanning
  }

  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let isDir: boolean;
    try {
      isDir = (await stat(full)).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      await walk(full, treeRoot, entries, issues);
      continue;
    }
    if (!name.endsWith(".md")) continue;

    const entry = await scanFile(full, treeRoot);
    entries.push(entry);

    if (entry.hasConflictMarkers) {
      issues.push({
        class: "conflict-markers",
        path: entry.relPath,
        itemId: entry.id,
        message: "unresolved merge conflict markers — resolve them, then re-run",
        repairable: false,
      });
      // A file mid-conflict has two of everything; skip its other checks.
      continue;
    }

    if (entry.level !== undefined && VALID_LEVELS.has(entry.level)) {
      const implied = depthImpliedLevel(entry.depth);
      if (entry.level !== implied) {
        issues.push({
          class: "level-mismatch",
          path: entry.relPath,
          itemId: entry.id,
          message: `level is "${entry.level}" but the item sits at ${implied} depth (${entry.depth})`,
          repairable: true,
          detail: [implied],
        });
      }
    }
  }
}

async function scanFile(fullPath: string, treeRoot: string): Promise<ScannedEntry> {
  const relPath = toRel(treeRoot, fullPath);
  let text = "";
  try {
    text = await readFile(fullPath, "utf-8");
  } catch {
    // Unreadable file: report nothing here — git status will surface it.
  }

  // The item's depth: a folder item is its directory (index.md's parent), a
  // leaf file is itself. Both come out as the number of path segments.
  const segments = relPath.split("/");
  const depth = segments[segments.length - 1] === "index.md" ? segments.length - 1 : segments.length;

  return {
    relPath,
    depth,
    id: matchScalar(text, "id"),
    level: matchScalar(text, "level"),
    blockedBy: matchList(text, "blockedBy"),
    hasConflictMarkers: CONFLICT_MARKERS.test(text),
    isParentShim: matchScalar(text, "__parentId") !== undefined,
    childLinks: parseChildrenTable(text),
  };
}

// ── Children table ────────────────────────────────────────────────────────────

/**
 * The `## Children` block, heading included, up to the next `##` heading or the
 * end of the file. `(?![\s\S])` is the end-of-input assertion — `$` cannot be
 * used for it here, because `m` makes `$` match at every line end.
 */
const CHILDREN_SECTION = /^##[^\S\n]+Children[^\S\n]*$([\s\S]*?)(?=^##[^\S\n]|(?![\s\S]))/m;
/**
 * A markdown link target: the `](…)` half only, deliberately not the `[label]`
 * half. Titles routinely contain square brackets — "Color-code [Tool], [Agent]
 * … labels" is a real item in this repo's own tree — and the serializer writes
 * `[${title}](${link})` without escaping them, so a label-anchored pattern
 * fails to match exactly those rows and reports the child as unlisted.
 */
const CHILD_LINK = /\]\(([^)\s]+)\)/g;

/**
 * Link targets from a file's `## Children` table, in table order, normalised
 * to the directory-relative form the serializer writes. `undefined` when there
 * is no Children section — distinct from `[]`, which means an empty table.
 *
 * One link per row, taken as the row's *last* `](…)`: the serializer puts the
 * child link at the end of the row, so a bracketed or link-bearing title
 * cannot displace it.
 */
function parseChildrenTable(text: string): string[] | undefined {
  const section = CHILDREN_SECTION.exec(text);
  if (!section) return undefined;

  const links: string[] = [];
  for (const line of section[1].split("\n")) {
    if (!line.startsWith("|")) continue;
    const matches = [...line.matchAll(CHILD_LINK)];
    const last = matches[matches.length - 1];
    if (last) links.push(last[1].replace(/^\.\//, ""));
  }
  return links;
}

/**
 * Compare each folder item's Children table against the directory it sits in.
 *
 * Both directions are reported under one class: a child on disk but absent
 * from the table (the shape #391 produced) and a row pointing at a file that
 * is no longer there. Neither loses data — the parser reads the directory, not
 * the table — but both make the tree lie to anyone reading it.
 */
function detectChildrenTableDrift(entries: ScannedEntry[]): PostMergeIssue[] {
  // Directory of each folder item, keyed by the directory's path relative to
  // the tree root. Only an `index.md` owns a Children table; a leaf `<slug>.md`
  // has no directory of its own and so has no children to list. An `index.md`
  // with no `id` is not an item — `rex init` writes exactly one, the banner at
  // the tree root, whose "children" are every epic in the PRD.
  const folderItems = new Map<string, ScannedEntry>();
  for (const entry of entries) {
    const dir = owningDirOfIndex(entry.relPath);
    if (dir === null || entry.id === undefined) continue;
    folderItems.set(dir, entry);
  }

  const issues: PostMergeIssue[] = [];
  for (const [dir, owner] of folderItems) {
    // A file mid-conflict has two of everything; its table is not meaningful.
    if (owner.hasConflictMarkers) continue;

    const onDisk = childLinksOnDisk(dir, entries);
    const listed = owner.childLinks ?? [];
    const missing = onDisk.filter((link) => !listed.includes(link));
    const stale = listed.filter((link) => !onDisk.includes(link));
    if (missing.length === 0 && stale.length === 0) continue;

    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `omits ${missing.length} of ${onDisk.length} child${onDisk.length === 1 ? "" : "ren"} ` +
          `present in the directory (${missing.join(", ")})`,
      );
    }
    if (stale.length > 0) {
      parts.push(`lists ${stale.length} entr${stale.length === 1 ? "y" : "ies"} that is not on disk (${stale.join(", ")})`);
    }

    issues.push({
      class: "children-table-out-of-sync",
      path: owner.relPath,
      itemId: owner.id,
      message:
        `## Children ${parts.join(" and ")} — cosmetic: the loader walks the directory and never ` +
        `reads this table, so the items are intact and the next full-tree save rewrites it. ` +
        `Repair rewrites it now so the tree stops misreporting itself.`,
      repairable: true,
      detail: missing,
    });
  }

  return issues;
}

/**
 * The child links the serializer would write for the item owning `dir`:
 * `<name>/index.md` for each subdirectory that is itself an item, and
 * `<name>.md` for each sibling leaf file. Ordered the way the parser builds
 * `children` — subdirectories alphabetically, then leaf files alphabetically —
 * so a repaired table matches what the next save produces.
 */
/**
 * The directory a file owns as its item's folder, or `null` when the file is
 * not an `index.md`. Matches the basename exactly — `my-index.md` is a leaf
 * child, not a folder item's own file.
 */
function owningDirOfIndex(relPath: string): string | null {
  if (relPath === "index.md") return "";
  if (!relPath.endsWith("/index.md")) return null;
  return relPath.slice(0, -"/index.md".length);
}

function childLinksOnDisk(dir: string, entries: ScannedEntry[]): string[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  const branches: string[] = [];
  const leaves: string[] = [];

  for (const entry of entries) {
    if (!entry.relPath.startsWith(prefix)) continue;
    const rest = entry.relPath.slice(prefix.length);
    if (rest === "index.md") continue; // the owner itself
    // A file with no id is not an item the parser would load (a README, say),
    // and a shim is handled on the parser's separate orphaned-child path.
    if (entry.id === undefined || entry.isParentShim) continue;

    const slash = rest.indexOf("/");
    if (slash === -1) {
      leaves.push(rest);
    } else if (rest.slice(slash) === "/index.md") {
      // An immediate subdirectory's own index.md. Anything deeper belongs to
      // that child, and a subdirectory with no index.md is not an item at all
      // — that is `orphaned-directory`, reported as its own class.
      branches.push(rest);
    }
  }

  return [...branches.sort(), ...leaves.sort()];
}

async function countMarkdownInside(dir: string): Promise<number> {
  let count = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    try {
      if ((await stat(full)).isDirectory()) {
        count += await countMarkdownInside(full);
      } else if (name.endsWith(".md")) {
        count++;
      }
    } catch {
      // vanished mid-scan
    }
  }
  return count;
}

// ── Repair ────────────────────────────────────────────────────────────────────

/**
 * Apply the deterministic repairs; ambiguous classes are returned untouched
 * in `refused`. Callers re-detect afterwards for the authoritative state.
 */
export async function repairPostMergeIssues(
  treeRoot: string,
  issues: PostMergeIssue[],
): Promise<{ repaired: PostMergeIssue[]; refused: PostMergeIssue[] }> {
  const repaired: PostMergeIssue[] = [];
  const refused: PostMergeIssue[] = [];

  // Rebuilding a Children table needs the directory census the detector used.
  // Scanned lazily and once: most repair runs never touch this class, and the
  // ones that do must all see the same tree.
  let census: ScannedEntry[] | null = null;
  const scanned = async (): Promise<ScannedEntry[]> => {
    if (census === null) {
      census = [];
      await walk(treeRoot, treeRoot, census, []);
    }
    return census;
  };

  for (const issue of issues) {
    if (!issue.repairable) {
      refused.push(issue);
      continue;
    }
    const fullPath = join(treeRoot, ...issue.path.split("/"));
    try {
      switch (issue.class) {
        case "orphaned-directory":
          await rm(fullPath, { recursive: true, force: true });
          break;
        case "level-mismatch":
          await rewriteFile(fullPath, (text) =>
            text.replace(/^level:.*$/m, `level: ${JSON.stringify(issue.detail?.[0] ?? "subtask")}`),
          );
          break;
        case "dangling-blocked-by":
          await rewriteFile(fullPath, (text) => dropBlockedByRefs(text, new Set(issue.detail ?? [])));
          break;
        case "children-table-out-of-sync": {
          const rows = await renderChildRows(treeRoot, issue.path, await scanned());
          await rewriteFile(fullPath, (text) => replaceChildrenTable(text, rows));
          break;
        }
        default:
          refused.push(issue);
          continue;
      }
      repaired.push(issue);
    } catch {
      refused.push(issue);
    }
  }

  return { repaired, refused };
}

async function rewriteFile(fullPath: string, transform: (text: string) => string): Promise<void> {
  const text = await readFile(fullPath, "utf-8");
  const next = transform(text);
  if (next !== text) await writeFile(fullPath, next, "utf-8");
}

/** Remove the given ids from a block-style blockedBy list; drop the field when empty. */
function dropBlockedByRefs(text: string, dangling: Set<string>): string {
  const chunk = /^blockedBy:[^\S\n]*\n((?:[ \t]+-[^\n]*\n)*)/m.exec(text);
  if (!chunk) return text;

  const kept = chunk[1]
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const value = stripQuotes((/^\s*-\s*(.*)$/.exec(line)?.[1] ?? "").trim());
      return !dangling.has(value);
    });

  const replacement = kept.length > 0 ? `blockedBy:\n${kept.join("\n")}\n` : "";
  return text.replace(chunk[0], replacement);
}

/**
 * Table rows for every child of the item at `indexRelPath`, in the order the
 * parser builds `children` and rendered the way the serializer renders them,
 * so a repaired table is the table the next full-tree save would write.
 */
async function renderChildRows(
  treeRoot: string,
  indexRelPath: string,
  entries: ScannedEntry[],
): Promise<string[]> {
  const dir = owningDirOfIndex(indexRelPath);
  if (dir === null) return [];
  const rows: string[] = [];

  for (const link of childLinksOnDisk(dir, entries)) {
    const childRel = dir === "" ? link : `${dir}/${link}`;
    let text = "";
    try {
      text = await readFile(join(treeRoot, ...childRel.split("/")), "utf-8");
    } catch {
      continue; // vanished between scan and repair — the next run re-reports it
    }
    // A child with no readable title would render a blank link. Falling back to
    // its path keeps the row navigable and makes the gap visible.
    const title = matchScalar(text, "title") || link;
    const status = matchScalar(text, "status") || "pending";
    rows.push(`| [${title}](./${link}) | ${status} |`);
  }

  return rows;
}

/**
 * Replace the file's `## Children` section with `rows`, or append one when the
 * file has none. An item whose children have all gone loses the section
 * entirely, matching the serializer, which omits it for a childless item.
 */
function replaceChildrenTable(text: string, rows: string[]): string {
  const section =
    rows.length === 0
      ? ""
      : ["## Children", "", "| Title | Status |", "|-------|--------|", ...rows, ""].join("\n");

  const existing = CHILDREN_SECTION.exec(text);
  if (existing) {
    const before = text.slice(0, existing.index);
    const after = text.slice(existing.index + existing[0].length);
    return `${before}${section}${after}`;
  }
  if (section === "") return text;
  return `${text.endsWith("\n") ? text : `${text}\n`}\n${section}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRel(treeRoot: string, fullPath: string): string {
  return relative(treeRoot, fullPath).split(sep).join("/");
}

function matchScalar(text: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:[^\\S\\n]*(.+)$`, "m").exec(frontmatterOnly(text));
  return m ? stripQuotes(m[1].trim()) : undefined;
}

function matchList(text: string, key: string): string[] {
  const m = new RegExp(`^${key}:[^\\S\\n]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, "m").exec(frontmatterOnly(text));
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => /^\s*-\s*(.*)$/.exec(line)?.[1])
    .filter((v): v is string => v !== undefined)
    .map((v) => stripQuotes(v.trim()))
    .filter(Boolean);
}

/** The frontmatter block, so body prose cannot fake a field. */
function frontmatterOnly(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(text);
  return m ? m[1] : "";
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
