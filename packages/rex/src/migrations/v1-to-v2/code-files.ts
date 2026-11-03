/**
 * Migration plan, code evidence: the code files the analysis ties to each item.
 *
 * The spec drafter (`./capability-spec.ts`) takes a capability → code files map
 * and cannot build one itself: the evidence is sourcevision's, and rex never
 * imports sourcevision. This reads the analysis output off disk the way
 * `analyze/scanners.ts` already does, and the CLI calls it **before** planning.
 * Nothing here runs inside the migration — the rules and stages stay pure and
 * read only what the caller hands them.
 *
 * Two signals, unioned per item:
 *
 * - **Zones.** `zones.json` names each zone and lists its files. A zone whose
 *   id or name shares enough of the item's **title** contributes its non-test
 *   files. Only the title: a zone is a place in the code and the title names
 *   it, whereas criteria describe behaviour, and their words reach zones the
 *   capability has nothing to do with — "Zones are detected from the import
 *   graph" matched the dashboard's import-graph view on this repository. Only
 *   the best-scoring zones count, and a tie wider than {@link MAX_LINKED_ZONES}
 *   counts for nothing: the words are generic then, not the zone's.
 * - **Tests.** The tests linked to the item's criteria, matched by the
 *   drafter's own `linkedTests` so the two agree, exercise the files they
 *   import (`imports.json`).
 *
 * The union is ranked by how much of the item each path names and capped at
 * {@link DEFAULT_MAX_FILES}: `codeFiles` is quoted verbatim into the spec
 * drafting prompt (`analyze/spec-draft-reason.ts`), so a 170-file zone handed
 * over whole is paid for on every capability it matches.
 *
 * The map is plan input, never stored state. A capability carries no
 * `codeFiles` field in the v2 schema and must not grow one: that schema is
 * soft-frozen, and the evidence is re-derivable from an analysis at any time.
 *
 * @module migrations/v1-to-v2/code-files
 */

import { gunzipSync } from "node:zlib";
import { readdir } from "node:fs/promises";
import { loadTrailerCommits, loadCommitFiles } from "../../core/change-commits.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execStdout, layoutStateNames, resolveLayout } from "@n-dx/llm-client";
import type { PRDItem } from "../../schema/v1.js";
import { extractKeywords, scoreMatch } from "../../core/keywords.js";
import { DEFAULT_MIN_TEST_SCORE, indexItems, isTestFile, linkedTests } from "./capability-spec.js";

/** Analysis artifacts this reader needs, by basename; both are optional. */
const SV_ZONES_FILE = "zones.json";
const SV_IMPORTS_FILE = "imports.json";
const SV_MANIFEST_FILE = "manifest.json";

/** Below this a zone shares one word with the item, which most zone names do. */
export const DEFAULT_MIN_ZONE_SCORE = 2;
/** More equally good zones than this means the words are generic, not that the zone is the item's. */
const MAX_LINKED_ZONES = 2;
/** Most code files one item carries into the plan, and so into the drafting prompt. */
export const DEFAULT_MAX_FILES = 20;

export interface CodeFilesOptions {
  /** Repository test files, relative paths (`core/verify.ts`'s `findTestFiles`). */
  testFiles?: readonly string[];
  /** Fewest item words a zone's id or name must contain to contribute. Default {@link DEFAULT_MIN_ZONE_SCORE}. */
  minZoneScore?: number;
  /** Fewest criterion words a test path must contain to link; the drafter's default unless given. */
  minTestScore?: number;
  /** Most files one item carries. Default {@link DEFAULT_MAX_FILES}. */
  maxFiles?: number;
}

/** The fields of a sourcevision zone this reader uses; the rest of the schema is `analyze/scanners.ts`'s business. */
interface ZoneEvidence {
  id?: string;
  name?: string;
  files?: string[];
}

/** One import edge: `from` imports `to`, both repository-relative. */
interface ImportEdge {
  from?: string;
  to?: string;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    // A missing or unreadable artifact drops its signal; it never fails the plan.
    return undefined;
  }
}

/** Zones from either shape `zones.json` has had: the canonical `{ zones }` and the legacy flat array. */
function zonesOf(parsed: unknown): ZoneEvidence[] {
  // Null entries are filtered here rather than guarded at each use: this
  // module promises never to fail the plan over a malformed analysis, and a
  // `{"zones":[null]}` threw a TypeError downstream.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { zones?: unknown } | undefined)?.zones)
      ? ((parsed as { zones: unknown[] }).zones)
      : [];
  return list.filter((z): z is ZoneEvidence => z !== null && typeof z === "object");
}

/** For each test file, the files it imports: what that test exercises. */
function testImportsOf(parsed: unknown): Map<string, string[]> {
  const edges = (parsed as { edges?: unknown } | undefined)?.edges;
  const out = new Map<string, string[]>();
  if (!Array.isArray(edges)) return out;
  for (const edge of edges as (ImportEdge | null)[]) {
    if (edge === null || typeof edge !== "object") continue;
    const { from, to } = edge;
    if (!from || !to || !isTestFile(from) || isTestFile(to)) continue;
    const existing = out.get(from);
    if (existing) existing.push(to);
    else out.set(from, [to]);
  }
  return out;
}

/** Every word that names an item: its title and its acceptance criteria. Used to rank paths. */
function itemKeywords(item: PRDItem): string[] {
  return extractKeywords([item.title, ...(item.acceptanceCriteria ?? [])].join(" "));
}

/**
 * The non-test files of the zones that best match the item's title, or none
 * when no zone reaches `minScore` or too many tie.
 */
function zoneFiles(zones: readonly ZoneEvidence[], keywords: string[], minScore: number): string[] {
  if (keywords.length === 0) return [];
  let best = minScore;
  let matched: ZoneEvidence[] = [];
  for (const zone of zones) {
    const score = scoreMatch(`${zone.id ?? ""} ${zone.name ?? ""}`, keywords);
    if (score > best) {
      best = score;
      matched = [zone];
    } else if (score === best) {
      matched.push(zone);
    }
  }
  if (matched.length > MAX_LINKED_ZONES) return [];
  return matched.flatMap((z) => z.files ?? []).filter((f) => !isTestFile(f));
}

/** The files imported by the tests the item's criteria link to. */
function testedFiles(item: PRDItem, testFiles: readonly string[], imports: ReadonlyMap<string, string[]>, minScore: number): string[] {
  if (testFiles.length === 0 || imports.size === 0) return [];
  const tests = new Set((item.acceptanceCriteria ?? []).flatMap((c) => linkedTests(c, testFiles, minScore)));
  return [...tests].flatMap((test) => imports.get(test) ?? []);
}

/**
 * The capped evidence: the paths naming most of the item first, ties broken by
 * path, then sorted so the plan does not depend on the ranking's stability.
 */
function rank(files: Iterable<string>, keywords: string[], maxFiles: number): string[] {
  return [...new Set(files)]
    .sort((a, b) => scoreMatch(b, keywords) - scoreMatch(a, keywords) || a.localeCompare(b))
    .slice(0, maxFiles)
    .sort();
}

/**
 * Code files per v1 item id, for every item the analysis has evidence for.
 *
 * Returns an empty map when there is no analysis directory, so a project that
 * has never been analysed plans exactly as it did before — the drafter treats
 * a missing entry as no code evidence and says so in the capability's notes.
 * Items are keyed by v1 id; the drafter reads only the capability ones.
 */
/** When the analysis this evidence comes from was taken, and of what commit. */
export interface CodeEvidenceProvenance {
  /** ISO timestamp the analysis recorded for itself. */
  analyzedAt?: string;
  /** The commit it analysed, when it recorded one. */
  gitSha?: string;
}

/**
 * The analysis's own account of when it ran.
 *
 * The evidence above is only as current as the scan it came from, and a stale
 * `.sourcevision/` reads exactly like a fresh one: every file parses, every
 * zone has files, and the capability specs come out looking authoritative. The
 * caller reports this so an operator reviewing a plan can tell evidence drawn
 * from this commit from evidence drawn from one weeks old.
 *
 * Absent when there is no manifest, which is the same case as no evidence.
 */
export async function readCodeEvidenceProvenance(dir: string): Promise<CodeEvidenceProvenance | undefined> {
  const parsed = (await readJson(join(resolveLayout(dir).sourcevisionDir, SV_MANIFEST_FILE))) as
    | { analyzedAt?: unknown; gitSha?: unknown; repo?: { gitSha?: unknown } }
    | undefined;
  if (!parsed) return undefined;
  const analyzedAt = typeof parsed.analyzedAt === "string" ? parsed.analyzedAt : undefined;
  const fromRepo = typeof parsed.repo?.gitSha === "string" ? parsed.repo.gitSha : undefined;
  const gitSha = typeof parsed.gitSha === "string" ? parsed.gitSha : fromRepo;
  if (analyzedAt === undefined && gitSha === undefined) return undefined;
  return { ...(analyzedAt ? { analyzedAt } : {}), ...(gitSha ? { gitSha } : {}) };
}

/** {@link readCodeEvidence}'s result: the evidence, and whether there was any to read. */
export interface CodeEvidence {
  /** Item id -> the paths that evidence it. Items with no evidence are absent. */
  files: Record<string, string[]>;
  /**
   * Whether an analysis was readable at all.
   *
   * Distinguishes "no analysis on disk" from "an analysis that matched
   * nothing" — both produce an empty `files`, and the caller's advice to the
   * operator differs completely ("run ndx analyze" vs "the analysis is there,
   * it just scored nothing above the threshold").
   */
  analysisPresent: boolean;
}

/**
 * Capability code evidence, with whether an analysis existed to read.
 *
 * Prefer this over {@link readCapabilityCodeFiles} where the answer "none"
 * needs explaining.
 */
export async function readCodeEvidence(
  dir: string,
  items: readonly PRDItem[],
  options: CodeFilesOptions = {},
): Promise<CodeEvidence> {
  const svDir = resolveLayout(dir).sourcevisionDir;
  const [zonesRaw, importsRaw] = await Promise.all([
    readJson(join(svDir, SV_ZONES_FILE)),
    readJson(join(svDir, SV_IMPORTS_FILE)),
  ]);
  if (zonesRaw === undefined && importsRaw === undefined) {
    return { files: {}, analysisPresent: false };
  }

  const zones = zonesOf(zonesRaw);
  const imports = testImportsOf(importsRaw);
  const testFiles = options.testFiles ?? [];
  const minZoneScore = options.minZoneScore ?? DEFAULT_MIN_ZONE_SCORE;
  const minTestScore = options.minTestScore ?? DEFAULT_MIN_TEST_SCORE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  // An analysis goes stale: a zone keeps listing a file long after it is
  // deleted. Citing one in a capability spec reads as authoritative, and
  // worse, any surviving file suppressed the drafter's "confirm this
  // capability still exists" note — so staleness hid itself. Filter to paths
  // that are actually on disk, the same check `scanners.ts` makes with
  // `isStaleFinding`. Memoised: zones share files, and this runs per item.
  const onDisk = new Map<string, boolean>();
  const stillExists = (file: string): boolean => {
    let known = onDisk.get(file);
    if (known === undefined) {
      known = existsSync(join(dir, file));
      onDisk.set(file, known);
    }
    return known;
  };

  const out: Record<string, string[]> = {};
  for (const item of indexItems(items).values()) {
    const keywords = itemKeywords(item);
    const files = rank(
      [
        ...zoneFiles(zones, extractKeywords(item.title), minZoneScore),
        ...testedFiles(item, testFiles, imports, minTestScore),
      ].filter(stillExists),
      keywords,
      maxFiles,
    );
    // An item with no evidence is left out rather than keyed to an empty list:
    // the drafter reads a missing entry the same way and the plan stays smaller.
    if (files.length > 0) out[item.id] = files;
  }
  return { files: out, analysisPresent: true };
}

/** {@link readCodeEvidence}'s evidence alone, for callers that do not need the flag. */
export async function readCapabilityCodeFiles(
  dir: string,
  items: readonly PRDItem[],
  options: CodeFilesOptions = {},
): Promise<Record<string, string[]>> {
  return (await readCodeEvidence(dir, items, options)).files;
}


/**
 * Paths a commit touches as bookkeeping rather than as the work: lockfiles,
 * manifests, changelogs and changesets, and the tool state n-dx itself writes
 * (the PRD tree, hench runs, the analysis). Nearly every commit carries one,
 * so as evidence they tie every change to every capability: placement scores
 * each shared file, and a lockfile hit moved a held change out of the Inbox.
 */
const BOOKKEEPING_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "CHANGELOG.md",
]);
// n-dx's own state, in both layouts (the classifier form the layout resolver gives).
const BOOKKEEPING_DIRS = [".changeset", ...layoutStateNames().dirNames, "dist", "node_modules"];

/** True for a path {@link BOOKKEEPING_FILES} names by basename or that lies under a {@link BOOKKEEPING_DIRS} segment. */
export function isBookkeepingPath(path: string): boolean {
  // git spells paths with forward slashes on every platform.
  const parts = path.split("/").filter(Boolean);
  const base = parts.at(-1) ?? "";
  if (BOOKKEEPING_FILES.has(base)) return true;
  return parts.slice(0, -1).some((part) => BOOKKEEPING_DIRS.includes(part));
}

/**
 * A file in more items' commit evidence than this share of the items that
 * have any is common ground, not any one item's: a barrel, a shared config, a
 * test helper. Never below {@link MIN_COMMON_FILE_ITEMS}, so a small history
 * is not emptied by its own overlap.
 */
const COMMON_FILE_SHARE = 0.2;
const MIN_COMMON_FILE_ITEMS = 3;

export interface CommitCodeFilesOptions {
  /**
   * The tree being planned: evidence is collected for its items, at any depth,
   * and no others. Trailers and runs name items from all of history; one
   * outside the tree is never read, and would otherwise change the evidence
   * (and so the plan's evidence digest and cut time) whenever an unrelated
   * commit lands. Omitted: every id history names.
   */
  items?: readonly PRDItem[];
  /** Most files one item keeps; defaults to {@link DEFAULT_MAX_FILES}. */
  maxFiles?: number;
}

/**
 * Commit evidence collected by the CLI before running the pure migration: the
 * files the commits each item's trailers and hench runs name have changed.
 * Bookkeeping paths ({@link isBookkeepingPath}) are dropped, so are files
 * common to many items' histories ({@link COMMON_FILE_SHARE}), and each item
 * keeps its {@link DEFAULT_MAX_FILES} most-touched files.
 */
export async function readCommitCodeFiles(dir: string, options: CommitCodeFilesOptions = {}): Promise<Record<string, string[]>> {
  const layout = resolveLayout(dir);
  const wanted = options.items ? new Set(indexItems(options.items).keys()) : null;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const commitsFor = new Map<string, Set<string>>();
  const add = (id: string, sha: string) => {
    if (wanted && !wanted.has(id)) return;
    const commits = commitsFor.get(id) ?? new Set<string>();
    commits.add(sha);
    commitsFor.set(id, commits);
  };
  const cacheDir = join(layout.rexDir, ".cache");
  try {
    for (const commit of await loadTrailerCommits({ repoDir: dir, cacheDir })) {
      for (const id of commit.items) add(id, commit.hash);
    }
  } catch { /* A missing or shallow git history contributes no trailer signal. */ }
  try {
    const runsDir = join(layout.henchDir, "runs");
    for (const name of await readdir(runsDir)) {
      if (name.startsWith(".") || !/\.json(?:\.gz)?$/.test(name)) continue;
      try {
        const raw = await readFile(join(runsDir, name));
        const run = JSON.parse(name.endsWith(".gz") ? gunzipSync(raw).toString("utf-8") : raw.toString("utf-8")) as { taskId?: unknown; commits?: Array<{ sha?: unknown }> };
        if (typeof run.taskId !== "string" || !Array.isArray(run.commits)) continue;
        for (const commit of run.commits) if (typeof commit?.sha === "string") add(run.taskId, commit.sha);
      } catch { /* A damaged run must not prevent planning. */ }
    }
  } catch { /* Projects without runs have no run evidence. */ }
  let changed: Map<string, string[]>;
  try {
    const candidates = [...new Set([...commitsFor.values()].flatMap((commits) => [...commits]))].filter((sha) => /^[a-f0-9]{40}$/i.test(sha));
    const known: string[] = [];
    for (let offset = 0; offset < candidates.length; offset += 256) {
      const output = await execStdout("git", ["log", "--no-walk=unsorted", "--ignore-missing", "--format=%H", ...candidates.slice(offset, offset + 256), "--"], { cwd: dir, timeout: 60_000 });
      known.push(...output.trim().split("\n").filter(Boolean));
    }
    changed = await loadCommitFiles(dir, cacheDir, known);
  } catch { return {}; }
  return rankCommitFiles(commitsFor, changed, maxFiles);
}

/**
 * Per item, how many of its commits touched each non-bookkeeping file; then
 * the files common to many items dropped and the rest ranked by that count.
 */
function rankCommitFiles(
  commitsFor: ReadonlyMap<string, ReadonlySet<string>>,
  changed: ReadonlyMap<string, readonly string[]>,
  maxFiles: number,
): Record<string, string[]> {
  const touches = new Map<string, Map<string, number>>();
  const itemsWith = new Map<string, number>();
  for (const [id, commits] of commitsFor) {
    const counts = new Map<string, number>();
    for (const sha of commits) {
      for (const file of changed.get(sha) ?? []) {
        if (!isBookkeepingPath(file)) counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }
    if (counts.size === 0) continue;
    touches.set(id, counts);
    for (const file of counts.keys()) itemsWith.set(file, (itemsWith.get(file) ?? 0) + 1);
  }
  const commonAbove = Math.max(MIN_COMMON_FILE_ITEMS, Math.ceil(COMMON_FILE_SHARE * touches.size));
  const out: Record<string, string[]> = {};
  for (const [id, counts] of touches) {
    const files = [...counts]
      .filter(([file]) => (itemsWith.get(file) ?? 0) <= commonAbove)
      .sort((a, b) => b[1] - a[1] || (itemsWith.get(a[0]) ?? 0) - (itemsWith.get(b[0]) ?? 0) || a[0].localeCompare(b[0]))
      .slice(0, maxFiles)
      .map(([file]) => file)
      .sort();
    if (files.length > 0) out[id] = files;
  }
  return out;
}
