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

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
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
  if (Array.isArray(parsed)) return parsed as ZoneEvidence[];
  const zones = (parsed as { zones?: unknown } | undefined)?.zones;
  return Array.isArray(zones) ? (zones as ZoneEvidence[]) : [];
}

/** For each test file, the files it imports: what that test exercises. */
function testImportsOf(parsed: unknown): Map<string, string[]> {
  const edges = (parsed as { edges?: unknown } | undefined)?.edges;
  const out = new Map<string, string[]>();
  if (!Array.isArray(edges)) return out;
  for (const edge of edges as ImportEdge[]) {
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

export async function readCapabilityCodeFiles(
  dir: string,
  items: readonly PRDItem[],
  options: CodeFilesOptions = {},
): Promise<Record<string, string[]>> {
  const svDir = resolveLayout(dir).sourcevisionDir;
  const [zonesRaw, importsRaw] = await Promise.all([
    readJson(join(svDir, SV_ZONES_FILE)),
    readJson(join(svDir, SV_IMPORTS_FILE)),
  ]);
  if (zonesRaw === undefined && importsRaw === undefined) return {};

  const zones = zonesOf(zonesRaw);
  const imports = testImportsOf(importsRaw);
  const testFiles = options.testFiles ?? [];
  const minZoneScore = options.minZoneScore ?? DEFAULT_MIN_ZONE_SCORE;
  const minTestScore = options.minTestScore ?? DEFAULT_MIN_TEST_SCORE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  const out: Record<string, string[]> = {};
  for (const item of indexItems(items).values()) {
    const keywords = itemKeywords(item);
    const files = rank(
      [
        ...zoneFiles(zones, extractKeywords(item.title), minZoneScore),
        ...testedFiles(item, testFiles, imports, minTestScore),
      ],
      keywords,
      maxFiles,
    );
    // An item with no evidence is left out rather than keyed to an empty list:
    // the drafter reads a missing entry the same way and the plan stays smaller.
    if (files.length > 0) out[item.id] = files;
  }
  return out;
}
