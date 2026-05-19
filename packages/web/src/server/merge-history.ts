/**
 * Merge history data pipeline — walks git merges and correlates them to PRD items.
 *
 * This module is the data foundation for the PRD/merge context-graph view. It:
 *
 *   1. Enumerates merge commits via `git log --merges`.
 *   2. Extracts file-change summaries per merge (vs. first parent).
 *   3. Correlates each merge to PRD item IDs using three strategies:
 *        - commit message references (full UUIDs embedded in subject/body)
 *        - merged source branch names (e.g. `task/<short-id>`, `feature/<id>`)
 *        - hench run metadata (runs that finished in a window before the merge
 *          contribute their `taskId` as the run's attributed PRD item)
 *   4. Assembles a graph payload with PRD nodes, merge nodes, and attributed edges.
 *
 * The graph is content-addressed by a lightweight fingerprint so callers can
 * cache it: fingerprint changes when a new merge lands, the PRD is updated, or
 * hench runs are added / removed.
 *
 * ## Design notes
 *
 * Git is invoked via `execFileSync` with no shell so no argument escaping is
 * needed. Calls go through an injectable {@link GitRunner} so unit tests can
 * drive the pipeline without a real repository. Hench run enumeration is
 * likewise injectable.
 *
 * All parsing helpers are pure and individually exported so tests can target
 * them directly without spinning up a server.
 *
 * @module web/server/merge-history
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadPRDSync, prdMaxMtimeMs } from "./prd-io.js";
import type { PRDDocument, PRDItem } from "./rex-gateway.js";
import { resolveSiblingSlugs } from "./rex-gateway.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Status of a file change in a merge, mapped from git name-status codes. */
export type FileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "unmerged"
  | "unknown";

/** A single file change introduced by a merge (vs. the merge's first parent). */
export interface FileChange {
  status: FileChangeStatus;
  path: string;
  /** Previous path when the status is `renamed` or `copied`. */
  oldPath?: string;
}

/** How an edge between a merge and a PRD item was derived. */
export type EdgeAttribution = "commit-message" | "branch-name" | "hench-run";

/** An edge connecting a merge node to a PRD-item node. */
export interface MergeGraphEdge {
  /** The merge commit's full SHA. */
  from: string;
  /** The PRD item ID. */
  to: string;
  attribution: EdgeAttribution;
}

/** A PRD item node in the graph. */
export interface PrdNode {
  kind: "prd";
  id: string;
  title: string;
  level: string;
  status: string;
  parentId?: string;
  priority?: string;
  /** Shape classification based on folder structure: diamond, square, trapezoid, triangle, circle. */
  shape?: string;
}

/** A merge commit node in the graph. */
export interface MergeNode {
  kind: "merge";
  id: string; // same as sha — kept for payload uniformity with PrdNode.id
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  mergedAt: string; // ISO 8601
  author: string;
  parents: string[];
  sourceBranch?: string;
  filesSummary: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
    copied: number;
    other: number;
    total: number;
  };
  files: FileChange[];
}

/**
 * Introducing-commit metadata for a single PRD item — the commit that first
 * added the item's `index.md` to the repo, plus its author and any
 * `Co-Authored-By:` trailers from the commit body.
 *
 * Resolved on-demand via {@link resolveItemOrigin}; surfaced through the
 * `/api/prd-origin` route and rendered in the context-graph detail panel.
 */
export interface PrdOrigin {
  sha: string;
  shortSha: string;
  /** Committer ISO date (`%cI`) — when the introducing commit landed. */
  createdAt: string;
  /** Primary author display name (`%an`). */
  author: string;
  /** Primary author email (`%ae`). */
  authorEmail: string;
  /** Parsed `Co-Authored-By: Name <email>` trailers from `%b`. */
  coAuthors: Array<{ name: string; email: string }>;
  /** Subject line (`%s`) of the introducing commit. */
  subject: string;
}

/** Fingerprint used for incremental cache invalidation. */
export interface MergeGraphFingerprint {
  headMergeSha: string | null;
  mergeCount: number;
  prdMtimeMs: number;
  henchRunsMtimeMs: number;
  henchRunsCount: number;
}

/** Full graph payload returned by the API endpoint. */
export interface MergeGraph {
  generatedAt: string;
  fingerprint: MergeGraphFingerprint;
  nodes: Array<PrdNode | MergeNode>;
  edges: MergeGraphEdge[];
  stats: {
    merges: number;
    mergesWithPrdLinkage: number;
    mergesWithoutPrdLinkage: number;
    prdItemsLinked: number;
  };
}

/** Minimal hench run shape needed for merge correlation. */
export interface HenchRunSummary {
  id: string;
  taskId: string;
  finishedAt?: string;
  lastActivityAt?: string;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Git runner — injectable so unit tests can drive the pipeline
// ---------------------------------------------------------------------------

/**
 * Runs a git command and returns stdout. May throw on non-zero exit. The
 * default implementation uses `execFileSync` (no shell — no escaping needed).
 */
export type GitRunner = (args: string[]) => string;

/** Build a git runner bound to a project directory. */
export function createGitRunner(projectDir: string): GitRunner {
  return (args: string[]) =>
    execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      // Suppress noisy stderr for expected failures (non-repo directory, etc.)
      stdio: ["pipe", "pipe", "pipe"],
      // Cap subprocess output to something reasonable.
      maxBuffer: 32 * 1024 * 1024,
    });
}

// ---------------------------------------------------------------------------
// Parsing helpers (pure functions — unit-test targets)
// ---------------------------------------------------------------------------

/** Full UUID v4-ish pattern used throughout rex for PRD item IDs. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Map a git name-status code letter to our canonical {@link FileChangeStatus}. */
export function mapNameStatus(code: string): FileChangeStatus {
  const first = (code[0] ?? "").toUpperCase();
  switch (first) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

/**
 * Extract a source branch name from a merge commit subject.
 *
 * Handles the common git / GitHub merge subjects:
 *   - `Merge branch 'foo'`
 *   - `Merge branch 'foo' into main`
 *   - `Merge pull request #123 from user/branch-name`
 *   - `Merge remote-tracking branch 'origin/foo'`
 *
 * Returns undefined when no source branch can be parsed.
 */
export function parseSourceBranch(subject: string): string | undefined {
  if (!subject) return undefined;

  // GitHub / pull-request style — "user/branch-name": keep the branch segment
  // after the first slash so we match against the actual branch name.
  const pr = subject.match(/^Merge pull request #\d+ from ([^\s]+)/);
  if (pr) {
    const slash = pr[1].indexOf("/");
    return slash === -1 ? pr[1] : pr[1].slice(slash + 1);
  }

  // Remote-tracking merges — strip the remote prefix (`origin/foo` -> `foo`).
  const remote = subject.match(/^Merge remote-tracking branch '([^']+)'/);
  if (remote) {
    const name = remote[1];
    const slash = name.indexOf("/");
    return slash === -1 ? name : name.slice(slash + 1);
  }

  // Classic git merge subjects — branch name is quoted and kept verbatim
  // (preserving `feature/foo` style prefixes so branch-based PRD correlation
  // can inspect every segment).
  const quoted = subject.match(/^Merge branch '([^']+)'/);
  if (quoted) return quoted[1];

  return undefined;
}

/** Extract all PRD UUIDs from a free-text commit message. */
export function extractPrdIdsFromMessage(
  message: string,
  knownIds: Set<string>,
): string[] {
  if (!message) return [];
  const found = new Set<string>();
  for (const match of message.matchAll(UUID_RE)) {
    const id = match[0].toLowerCase();
    if (knownIds.has(id)) found.add(id);
  }
  return [...found];
}

/**
 * Extract a PRD id from a branch name.
 *
 * Recognizes:
 *   - full-UUID suffix/segment (`task/<uuid>` or `<uuid>-slug`)
 *   - 8-char UUID prefix segment (`task/<short>` — matched against known prefixes)
 *
 * Returns the full UUID when a match is found.
 */
export function extractPrdIdFromBranch(
  branch: string,
  knownIds: Set<string>,
  shortIdIndex: Map<string, string>,
): string | undefined {
  if (!branch) return undefined;

  // Full UUID anywhere in the branch string
  const fullMatch = branch.toLowerCase().match(UUID_RE);
  if (fullMatch) {
    for (const candidate of fullMatch) {
      if (knownIds.has(candidate)) return candidate;
    }
  }

  // Short 8-char hex segments — lookup via prefix index
  const segments = branch.toLowerCase().split(/[^0-9a-f]+/).filter(Boolean);
  for (const seg of segments) {
    if (seg.length >= 8) {
      const prefix = seg.slice(0, 8);
      const full = shortIdIndex.get(prefix);
      if (full) return full;
    }
  }

  return undefined;
}

/**
 * Parse the output of `git log --merges` formatted with field separator U+001F
 * and record separator U+001E. One record per merge commit.
 */
export function parseMergeLogOutput(stdout: string): Array<{
  sha: string;
  parents: string[];
  mergedAt: string;
  author: string;
  subject: string;
  body: string;
}> {
  if (!stdout) return [];
  const records = stdout.split("");
  const merges = [];
  for (const raw of records) {
    const rec = raw.replace(/^\s+/, ""); // trim leading newline between records
    if (!rec) continue;
    const fields = rec.split("");
    if (fields.length < 6) continue;
    const [sha, parentsRaw, mergedAt, author, subject, body] = fields;
    if (!sha) continue;
    merges.push({
      sha: sha.trim(),
      parents: parentsRaw.trim().split(/\s+/).filter(Boolean),
      mergedAt: mergedAt.trim(),
      author: author.trim(),
      subject: subject.trim(),
      // Body is everything after the subject field — keep trailing newlines trimmed.
      body: body.replace(/\s+$/, ""),
    });
  }
  return merges;
}

/** Shape classification for PRD nodes based on folder structure. */
export type NodeShape = "diamond" | "square" | "trapezoid" | "triangle" | "circle";

/**
 * Classify a PRD node's shape based on its folder structure in the prd_tree.
 *
 * Rules:
 *   - triangle: leaf node with no children (no subdirectories, no other .md files)
 *   - diamond: parent with title.md + other .md files (leaf subtasks)
 *   - trapezoid: parent with title.md + only subdirectories (no other .md files)
 *   - square: parent with only .md files and no subdirectories (legacy edge case)
 *   - circle: default for anything that doesn't match above
 *
 * @param itemId - The PRD item's ID
 * @param folderPath - Path to the item's folder in prd_tree
 * @returns The shape classification
 */
export function classifyNodeShape(
  itemId: string,
  folderPath: string,
): NodeShape {
  try {
    const entries = readdirSync(folderPath, { withFileTypes: true });
    if (!entries.length) return "triangle";

    // Separate files and directories
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    // Identify the title file (either title-named .md or legacy index.md)
    const titleFile = files.find((f) => f === "index.md" || f.endsWith(".md"));
    const otherFiles = files.filter((f) => f !== titleFile);

    // No children at all (only title file, no other files or dirs)
    if (!titleFile && dirs.length === 0) return "triangle";
    if (titleFile && otherFiles.length === 0 && dirs.length === 0) return "triangle";

    // Title + other .md files, no directories (diamond)
    if (titleFile && otherFiles.length > 0 && dirs.length === 0) return "diamond";

    // Title + only other .md files (all files, no directories) (square)
    // This is different from diamond in that there's no requirement for index.md specifically
    if (titleFile && otherFiles.length > 0 && dirs.length === 0) return "square";

    // Title + only directories, no other .md files (trapezoid)
    if (titleFile && otherFiles.length === 0 && dirs.length > 0) return "trapezoid";

    // Title + both other .md files and directories (unusual but possible with mixed children)
    if (titleFile && otherFiles.length > 0 && dirs.length > 0) return "diamond";

    // Default fallback
    return "circle";
  } catch {
    // If we can't read the folder, default to circle
    return "circle";
  }
}

/**
 * Parse the output of a batched `git show --name-status` call that uses
 * `__NDXSHA__ <sha>` marker lines to delimit per-merge file blocks.
 */
export function parseNameStatusOutput(
  stdout: string,
): Map<string, FileChange[]> {
  const out = new Map<string, FileChange[]>();
  if (!stdout) return out;
  const lines = stdout.split("\n");
  let currentSha: string | null = null;
  let currentList: FileChange[] | null = null;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("__NDXSHA__ ")) {
      currentSha = line.slice("__NDXSHA__ ".length).trim();
      currentList = [];
      out.set(currentSha, currentList);
      continue;
    }
    if (!currentList) continue; // file status line seen before any marker — skip

    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const code = parts[0];
    const status = mapNameStatus(code);

    if (status === "renamed" || status === "copied") {
      if (parts.length < 3) continue;
      currentList.push({ status, path: parts[2], oldPath: parts[1] });
    } else {
      currentList.push({ status, path: parts[1] });
    }
  }

  return out;
}

/**
 * Compute the slug for a PRD item based on its title and ID.
 * This is a simplified version that matches the folder-tree-serializer's behavior.
 */
function itemToSlug(item: PRDItem): string {
  const title = item.title.toLowerCase().trim();
  if (!title) return item.id.slice(0, 8);

  // Very simplified slug: lowercase, replace spaces with hyphens, remove special chars
  let slug = title
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) slug = item.id.slice(0, 8);
  // Keep slug reasonably short for filesystem compatibility
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+$/, "");
  return slug;
}

/** Build a flat tree of PRDNode objects along with a parent-lookup map. */
export function flattenPrdItems(doc: PRDDocument, rexDir?: string): {
  nodes: PrdNode[];
  knownIds: Set<string>;
  shortIdIndex: Map<string, string>;
} {
  const nodes: PrdNode[] = [];
  const knownIds = new Set<string>();
  const shortIdIndex = new Map<string, string>();
  // Map of item ID to its folder path for shape classification
  const idToFolderPath = new Map<string, string>();

  const walk = (items: PRDItem[], parentId?: string, parentPath?: string): void => {
    for (const item of items) {
      knownIds.add(item.id.toLowerCase());
      shortIdIndex.set(item.id.slice(0, 8).toLowerCase(), item.id);

      // Compute folder path for this item
      const slug = itemToSlug(item);
      const itemPath = parentPath ? join(parentPath, slug) : join(rexDir ?? ".rex", "prd_tree", slug);
      idToFolderPath.set(item.id, itemPath);

      // Classify shape based on folder structure if rexDir is provided
      let shape: string | undefined;
      if (rexDir) {
        try {
          shape = classifyNodeShape(item.id, itemPath);
        } catch {
          // If we can't read the folder, shape remains undefined
        }
      }

      nodes.push({
        kind: "prd",
        id: item.id,
        title: item.title,
        level: item.level,
        status: item.status,
        ...(parentId !== undefined && { parentId }),
        ...(item.priority !== undefined && { priority: item.priority }),
        ...(shape !== undefined && { shape }),
      });

      // Recursively walk children with updated parent ID and folder path
      if (item.children && item.children.length > 0) {
        walk(item.children, item.id, itemPath);
      }
    }
  };

  walk(doc.items);
  return { nodes, knownIds, shortIdIndex };
}

/**
 * Summarize a file list by status bucket (counts only). Useful in payloads
 * when the caller only wants the "shape" of a merge.
 */
export function summarizeFiles(files: FileChange[]): MergeNode["filesSummary"] {
  const summary = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    other: 0,
    total: files.length,
  };
  for (const f of files) {
    switch (f.status) {
      case "added":
        summary.added++;
        break;
      case "modified":
        summary.modified++;
        break;
      case "deleted":
        summary.deleted++;
        break;
      case "renamed":
        summary.renamed++;
        break;
      case "copied":
        summary.copied++;
        break;
      default:
        summary.other++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/** Compute the merge-graph fingerprint without building the full graph. */
export function computeFingerprint(opts: {
  rexDir: string;
  henchRunsDir: string;
  gitRunner: GitRunner;
  maxMerges: number;
}): MergeGraphFingerprint {
  let headMergeSha: string | null = null;
  let mergeCount = 0;
  try {
    const head = opts.gitRunner(["rev-list", "--merges", "-n", "1", "HEAD"]).trim();
    headMergeSha = head || null;
    const count = opts.gitRunner([
      "rev-list",
      "--merges",
      "--count",
      `--max-count=${opts.maxMerges}`,
      "HEAD",
    ]).trim();
    mergeCount = parseInt(count, 10) || 0;
  } catch {
    headMergeSha = null;
    mergeCount = 0;
  }

  const prdMtimeMs = prdMaxMtimeMs(opts.rexDir);

  let henchRunsMtimeMs = 0;
  let henchRunsCount = 0;
  if (existsSync(opts.henchRunsDir)) {
    try {
      const s = statSync(opts.henchRunsDir);
      henchRunsMtimeMs = s.mtimeMs;
      henchRunsCount = readdirSync(opts.henchRunsDir).filter(
        (f) =>
          !f.startsWith(".") && (f.endsWith(".json") || f.endsWith(".json.gz")),
      ).length;
    } catch {
      /* ignore */
    }
  }

  return { headMergeSha, mergeCount, prdMtimeMs, henchRunsMtimeMs, henchRunsCount };
}

/** Return true when two fingerprints are byte-for-byte equivalent. */
export function fingerprintsEqual(
  a: MergeGraphFingerprint,
  b: MergeGraphFingerprint,
): boolean {
  return (
    a.headMergeSha === b.headMergeSha &&
    a.mergeCount === b.mergeCount &&
    a.prdMtimeMs === b.prdMtimeMs &&
    a.henchRunsMtimeMs === b.henchRunsMtimeMs &&
    a.henchRunsCount === b.henchRunsCount
  );
}

// ---------------------------------------------------------------------------
// Hench run correlation
// ---------------------------------------------------------------------------

/**
 * For each merge, collect PRD-item IDs from hench runs whose final activity
 * timestamp falls in the window `[mergeTime - windowMs, mergeTime]`.
 *
 * The window stops at the previous merge's timestamp to prevent runs being
 * attributed to every subsequent merge.
 *
 * The input `merges` array must be sorted newest-first (which is the natural
 * order of `git log`). Runs with a `taskId` that is not in `knownIds` are
 * dropped so we never emit edges to unknown PRD items.
 */
export function correlateHenchRunsToMerges(
  merges: Array<{ sha: string; mergedAt: string }>,
  runs: HenchRunSummary[],
  knownIds: Set<string>,
  windowMs: number,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!merges.length || !runs.length) return out;

  // Merges sorted newest → oldest so we can step through them
  const sorted = [...merges].sort(
    (a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt),
  );

  // Only consider runs that have a known PRD item and a finalization timestamp
  const candidates = runs
    .map((r) => ({
      taskId: r.taskId,
      // Use the latest of finishedAt / lastActivityAt / startedAt for attribution.
      // Multiple fields are normal: `finishedAt` is absent while running, and
      // `lastActivityAt` is updated on periodic saves.
      at: Math.max(
        r.finishedAt ? Date.parse(r.finishedAt) : 0,
        r.lastActivityAt ? Date.parse(r.lastActivityAt) : 0,
        Date.parse(r.startedAt) || 0,
      ),
    }))
    .filter(
      (r) =>
        Number.isFinite(r.at) &&
        r.at > 0 &&
        knownIds.has(r.taskId.toLowerCase()),
    );

  if (!candidates.length) return out;

  for (let i = 0; i < sorted.length; i++) {
    const merge = sorted[i];
    const mergeAt = Date.parse(merge.mergedAt);
    if (!Number.isFinite(mergeAt)) continue;

    // Lower bound: the later of (merge - windowMs) and the previous (older) merge time.
    const prevMergeAt =
      i + 1 < sorted.length ? Date.parse(sorted[i + 1].mergedAt) : 0;
    const lowerBound = Math.max(mergeAt - windowMs, prevMergeAt);

    const attributedIds = new Set<string>();
    for (const run of candidates) {
      if (run.at > lowerBound && run.at <= mergeAt) {
        attributedIds.add(run.taskId);
      }
    }
    if (attributedIds.size > 0) out.set(merge.sha, attributedIds);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Git walkers (thin wrappers around the runner)
// ---------------------------------------------------------------------------

/** Field separator (U+001F — ASCII Unit Separator) used in our pretty-format. */
const FS = "";
/** Record separator (U+001E — ASCII Record Separator). */
const RS = "";

/**
 * List merge commits with metadata (subject, body, parents, timestamp, author).
 * Uses ASCII separators to avoid any ambiguity with newlines inside commit bodies.
 */
export function listMergeCommits(
  runner: GitRunner,
  maxMerges: number,
): Array<{
  sha: string;
  parents: string[];
  mergedAt: string;
  author: string;
  subject: string;
  body: string;
}> {
  const format = `%H${FS}%P${FS}%cI${FS}%an${FS}%s${FS}%b${RS}`;
  const stdout = runner([
    "log",
    "--merges",
    `--max-count=${maxMerges}`,
    `--pretty=format:${format}`,
  ]);
  return parseMergeLogOutput(stdout);
}

/** Regex for `Co-Authored-By:` trailers in commit bodies. */
const COAUTHOR_RE = /^Co-Authored-By:\s*([^<]+?)\s*<([^>]+)>\s*$/gim;

/**
 * Parse `Co-Authored-By: Name <email>` trailers from a commit body. Multiple
 * trailers are returned in source order; whitespace around the name and email
 * is trimmed. Names that resolve to empty after trimming are still kept (with
 * the email) so the caller can decide how to display them.
 */
export function parseCoAuthorTrailers(
  body: string,
): Array<{ name: string; email: string }> {
  if (!body) return [];
  const out: Array<{ name: string; email: string }> = [];
  // Reset the regex's lastIndex — `g` regexes are stateful between calls.
  COAUTHOR_RE.lastIndex = 0;
  for (const m of body.matchAll(COAUTHOR_RE)) {
    out.push({ name: m[1].trim(), email: m[2].trim() });
  }
  return out;
}

/**
 * Resolve the introducing commit for a single tracked path.
 *
 * Runs `git log --diff-filter=A --follow -1 -- <relPath>`, which returns the
 * commit that first added `relPath` to the repo (following renames). Returns
 * `null` when git produces no output — typically because the path isn't yet
 * tracked (e.g. a PRD item created in the working tree but never committed).
 *
 * Errors from the runner (non-git directory, etc.) propagate to the caller so
 * the route handler can surface a 500. Pure / runner-injected so tests don't
 * need a real git repository.
 */
export function resolveItemOrigin(
  runner: GitRunner,
  relPath: string,
): PrdOrigin | null {
  const format = `%H${FS}%cI${FS}%an${FS}%ae${FS}%s${FS}%b${RS}`;
  const stdout = runner([
    "log",
    "--diff-filter=A",
    "--follow",
    "-1",
    `--pretty=format:${format}`,
    "--",
    relPath,
  ]);
  if (!stdout) return null;
  // Single-record format (one commit max), but split on RS to be tolerant of
  // a trailing record separator from the format string.
  const record = stdout.split(RS)[0]?.trim();
  if (!record) return null;
  const fields = record.split(FS);
  if (fields.length < 5) return null;
  const [sha, createdAt, author, authorEmail, subject, body = ""] = fields;
  if (!sha) return null;
  return {
    sha,
    shortSha: sha.slice(0, 7),
    createdAt,
    author,
    authorEmail,
    coAuthors: parseCoAuthorTrailers(body),
    subject,
  };
}

/**
 * Batch-fetch file changes for the given merge SHAs, one `git show` call for
 * the entire batch. Uses `--diff-merges=first-parent` so we see what the
 * merged branch introduced vs. the branch it landed on.
 */
export function fetchMergeFileChanges(
  runner: GitRunner,
  shas: string[],
): Map<string, FileChange[]> {
  if (shas.length === 0) return new Map();
  const stdout = runner([
    "show",
    "--name-status",
    "--diff-merges=first-parent",
    "--pretty=format:__NDXSHA__ %H",
    ...shas,
  ]);
  return parseNameStatusOutput(stdout);
}

// ---------------------------------------------------------------------------
// Hench run enumeration (default implementation)
// ---------------------------------------------------------------------------

/**
 * Read just enough of each hench run file to extract the fields needed for
 * merge correlation. Kept minimal so we don't have to validate the full
 * schema (which is a rex/hench concern). Synchronous for parity with the
 * other sync web-server helpers.
 */
export function readHenchRunSummariesSync(henchRunsDir: string): HenchRunSummary[] {
  if (!existsSync(henchRunsDir)) return [];
  const out: HenchRunSummary[] = [];
  let entries: string[];
  try {
    entries = readdirSync(henchRunsDir);
  } catch {
    return [];
  }

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    // Skip gzipped runs in the sync path — they're typically older / archived
    // and not needed for fresh merge correlation.
    if (!name.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(henchRunsDir, name), "utf-8");
      const data = JSON.parse(raw) as Partial<HenchRunSummary>;
      if (
        typeof data.id === "string" &&
        typeof data.taskId === "string" &&
        typeof data.startedAt === "string"
      ) {
        out.push({
          id: data.id,
          taskId: data.taskId,
          startedAt: data.startedAt,
          ...(data.finishedAt !== undefined && { finishedAt: data.finishedAt }),
          ...(data.lastActivityAt !== undefined && { lastActivityAt: data.lastActivityAt }),
        });
      }
    } catch {
      // Skip unparseable run files
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export interface BuildMergeGraphOptions {
  projectDir: string;
  rexDir: string;
  /** Defaults to `<projectDir>/.hench/runs`. */
  henchRunsDir?: string;
  /** Cap on number of merge commits walked. Default 500. */
  maxMerges?: number;
  /**
   * Window (ms) before a merge's timestamp within which a hench run's final
   * activity attributes that run's taskId to the merge. Default 24h.
   */
  henchRunWindowMs?: number;
  /** Injection point for tests. */
  gitRunner?: GitRunner;
  /** Injection point for tests. */
  listHenchRuns?: () => HenchRunSummary[];
  /** Injection point for tests. */
  loadPRD?: () => PRDDocument | null;
}

/** Default attribution window — 24 hours. */
export const DEFAULT_HENCH_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Default merge cap. */
export const DEFAULT_MAX_MERGES = 500;

/**
 * Build the merge / PRD context graph.
 *
 * This is the single entry point used by the HTTP route and the cache.
 * It performs no I/O beyond what the injected runner/reader functions do,
 * so it's safe to call from any context (HTTP handler, test harness).
 */
export function buildMergeGraph(opts: BuildMergeGraphOptions): MergeGraph {
  const maxMerges = opts.maxMerges ?? DEFAULT_MAX_MERGES;
  const windowMs = opts.henchRunWindowMs ?? DEFAULT_HENCH_RUN_WINDOW_MS;
  const henchRunsDir =
    opts.henchRunsDir ?? join(opts.projectDir, ".hench", "runs");
  const runner = opts.gitRunner ?? createGitRunner(opts.projectDir);

  // ── 1. PRD index ────────────────────────────────────────────────
  const doc = opts.loadPRD ? opts.loadPRD() : loadPRDSync(opts.rexDir);
  const { nodes: prdNodes, knownIds, shortIdIndex } = doc
    ? flattenPrdItems(doc, opts.rexDir)
    : { nodes: [] as PrdNode[], knownIds: new Set<string>(), shortIdIndex: new Map<string, string>() };

  // ── 2. Merge enumeration + file changes ─────────────────────────
  let commits: ReturnType<typeof listMergeCommits> = [];
  try {
    commits = listMergeCommits(runner, maxMerges);
  } catch {
    // Not a git repository, or git unavailable — fall through with empty list.
    commits = [];
  }

  let fileChanges = new Map<string, FileChange[]>();
  if (commits.length > 0) {
    try {
      fileChanges = fetchMergeFileChanges(
        runner,
        commits.map((c) => c.sha),
      );
    } catch {
      fileChanges = new Map();
    }
  }

  // ── 3. Correlation edges ────────────────────────────────────────
  const edges: MergeGraphEdge[] = [];
  const edgeKey = (from: string, to: string, attr: EdgeAttribution): string =>
    `${from}|${to}|${attr}`;
  const seenEdges = new Set<string>();
  const addEdge = (from: string, to: string, attr: EdgeAttribution): void => {
    const k = edgeKey(from, to, attr);
    if (seenEdges.has(k)) return;
    seenEdges.add(k);
    edges.push({ from, to, attribution: attr });
  };

  const mergeNodes: MergeNode[] = [];
  const mergesWithLinkage = new Set<string>();
  const linkedPrdItems = new Set<string>();

  for (const c of commits) {
    const files = fileChanges.get(c.sha) ?? [];
    const sourceBranch = parseSourceBranch(c.subject);
    const filesSummary = summarizeFiles(files);

    const node: MergeNode = {
      kind: "merge",
      id: c.sha,
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      subject: c.subject,
      body: c.body,
      mergedAt: c.mergedAt,
      author: c.author,
      parents: c.parents,
      ...(sourceBranch !== undefined && { sourceBranch }),
      filesSummary,
      files,
    };
    mergeNodes.push(node);

    // Commit-message correlation
    const msgText = `${c.subject}\n${c.body}`;
    for (const id of extractPrdIdsFromMessage(msgText, knownIds)) {
      addEdge(c.sha, id, "commit-message");
      mergesWithLinkage.add(c.sha);
      linkedPrdItems.add(id);
    }

    // Branch-name correlation
    if (sourceBranch) {
      const branchId = extractPrdIdFromBranch(
        sourceBranch,
        knownIds,
        shortIdIndex,
      );
      if (branchId) {
        addEdge(c.sha, branchId, "branch-name");
        mergesWithLinkage.add(c.sha);
        linkedPrdItems.add(branchId);
      }
    }
  }

  // ── 4. Hench-run correlation ────────────────────────────────────
  const runs = opts.listHenchRuns
    ? opts.listHenchRuns()
    : readHenchRunSummariesSync(henchRunsDir);
  const runEdges = correlateHenchRunsToMerges(
    commits.map((c) => ({ sha: c.sha, mergedAt: c.mergedAt })),
    runs,
    knownIds,
    windowMs,
  );
  for (const [sha, taskIds] of runEdges) {
    for (const taskId of taskIds) {
      addEdge(sha, taskId, "hench-run");
      mergesWithLinkage.add(sha);
      linkedPrdItems.add(taskId);
    }
  }

  // ── 5. Fingerprint ──────────────────────────────────────────────
  const fingerprint = computeFingerprint({
    rexDir: opts.rexDir,
    henchRunsDir,
    gitRunner: runner,
    maxMerges,
  });

  return {
    generatedAt: new Date().toISOString(),
    fingerprint,
    nodes: [...prdNodes, ...mergeNodes],
    edges,
    stats: {
      merges: mergeNodes.length,
      mergesWithPrdLinkage: mergesWithLinkage.size,
      mergesWithoutPrdLinkage: mergeNodes.length - mergesWithLinkage.size,
      prdItemsLinked: linkedPrdItems.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Cached wrapper
// ---------------------------------------------------------------------------

/**
 * Single-entry cache for the merge graph keyed on its {@link MergeGraphFingerprint}.
 *
 * The graph is large-ish (all PRD items plus all merges with file lists) so
 * we keep only the most recent result. On each call we take a cheap
 * fingerprint; if it matches, we return the cached payload unchanged.
 */
export class MergeGraphCache {
  private cached: MergeGraph | null = null;

  /**
   * Return the cached graph when the fingerprint still matches, otherwise
   * rebuild and cache the result.
   */
  get(opts: BuildMergeGraphOptions): MergeGraph {
    const maxMerges = opts.maxMerges ?? DEFAULT_MAX_MERGES;
    const henchRunsDir =
      opts.henchRunsDir ?? join(opts.projectDir, ".hench", "runs");
    const runner = opts.gitRunner ?? createGitRunner(opts.projectDir);

    const fp = computeFingerprint({
      rexDir: opts.rexDir,
      henchRunsDir,
      gitRunner: runner,
      maxMerges,
    });

    if (this.cached && fingerprintsEqual(this.cached.fingerprint, fp)) {
      return this.cached;
    }

    this.cached = buildMergeGraph({ ...opts, gitRunner: runner, henchRunsDir });
    return this.cached;
  }

  /** Drop the cached result. Primarily for tests and explicit invalidation. */
  invalidate(): void {
    this.cached = null;
  }

  /** Whether a cached result is currently held. */
  get hasCachedValue(): boolean {
    return this.cached !== null;
  }
}
