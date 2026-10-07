/**
 * Placement ranking: which capabilities does a new change amend or touch?
 *
 * Tier 1 is rules, free and deterministic, and always runs. Tier 2 is the
 * configured text model (task class `prd.place`), reached through an injected
 * seam so this module reads no env, config or network. The text model is
 * uncalibrated: its pick is reported, and counts as agreement only when it is
 * the rules' top candidate. Deciding what to do with agreement (the
 * `autoAccept` setting) is the caller's job.
 *
 * @module core/placement
 */

import { extractKeywords } from "./keywords.js";

/** A product-layer capability as the ranker sees it. */
export interface PlacementCapability {
  id: string;
  title: string;
  statement?: string;
  /** Package names the capability lives in (e.g. `rex`, `@n-dx/web`). */
  packages?: string[];
  /** Path fragments that identify the capability's code (`src/core/`). */
  paths?: string[];
  /** Files and directories its past changes touched (the derived "realized by" edge). */
  realizedBy?: string[];
}

/** The change being placed. */
export interface PlacementChange {
  title: string;
  intent?: string;
  /** Files the change is known to touch. */
  files?: string[];
}

export interface PlacementCandidate {
  id: string;
  score: number;
  /** Which rules fired, for display and audit. */
  reasons: string[];
}

/** Injected text-model seam: pick one capability id from the shortlist, or null for none. */
export type PlacementModel = (input: {
  change: PlacementChange;
  shortlist: readonly PlacementCandidate[];
  capabilities: readonly PlacementCapability[];
}) => Promise<string | null>;

export interface PlacementResult {
  /** Rules ranking, best first. Empty when no rule fired. */
  shortlist: PlacementCandidate[];
  /** Present only when a model was supplied and the shortlist was non-empty. */
  model?: {
    /** What the model picked; null when it declined. */
    pick: string | null;
    /**
     * The pick is the rules' top candidate. False when the top score is tied:
     * the rules named no single leader, and the id tiebreak is arbitrary.
     */
    agrees: boolean;
  };
}

export const PLACEMENT_SHORTLIST_SIZE = 5;

// File evidence outranks a path mention, which outranks a package mention,
// which outranks a shared word.
const WEIGHT_FILE_EVIDENCE = 4;
const WEIGHT_PATH_MENTION = 3;
const WEIGHT_PACKAGE_MENTION = 2;
const WEIGHT_TOKEN = 1;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** `fragment` appears in `file` as whole path segments (`src/store` is in `a/src/store/x.ts`, not `a/src/store-utils.ts`). */
function containsSegments(file: string, fragment: string): boolean {
  return `/${file}/`.includes(`/${fragment}/`);
}

function mentions(text: string, needle: string): boolean {
  const escaped = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`).test(text.toLowerCase());
}

function scoreCapability(change: PlacementChange, cap: PlacementCapability): PlacementCandidate {
  const text = `${change.title}\n${change.intent ?? ""}`;
  let score = 0;
  const reasons: string[] = [];

  const files = (change.files ?? []).map(normalizePath);
  const evidence = (cap.realizedBy ?? []).map(normalizePath).filter(Boolean);
  const hits = files.filter((f) => evidence.some((e) => f === e || f.startsWith(`${e}/`)));
  if (hits.length > 0) {
    score += WEIGHT_FILE_EVIDENCE * hits.length;
    reasons.push(`file evidence: ${hits.join(", ")}`);
  }

  for (const p of (cap.paths ?? []).map(normalizePath).filter(Boolean)) {
    if (files.some((f) => containsSegments(f, p)) || mentions(text, p)) {
      score += WEIGHT_PATH_MENTION;
      reasons.push(`path: ${p}`);
    }
  }

  for (const pkg of (cap.packages ?? []).filter(Boolean)) {
    if (mentions(text, pkg)) {
      score += WEIGHT_PACKAGE_MENTION;
      reasons.push(`package: ${pkg}`);
    }
  }

  const changeWords = new Set(extractKeywords(text));
  const shared = extractKeywords(`${cap.title} ${cap.statement ?? ""}`).filter((w) => changeWords.has(w));
  if (shared.length > 0) {
    score += WEIGHT_TOKEN * shared.length;
    reasons.push(`words: ${shared.join(", ")}`);
  }

  return { id: cap.id, score, reasons };
}

/** Rules only: rank capabilities for a change, best first, ties broken by id. */
export function rankPlacementCandidates(
  change: PlacementChange,
  capabilities: readonly PlacementCapability[],
  size: number = PLACEMENT_SHORTLIST_SIZE,
): PlacementCandidate[] {
  return capabilities
    .map((cap) => scoreCapability(change, cap))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, size);
}

/**
 * Rank with rules, then ask the text model when one is supplied. A model error
 * propagates; with no model the shortlist is returned alone.
 */
export async function placeChange(
  change: PlacementChange,
  capabilities: readonly PlacementCapability[],
  options: { model?: PlacementModel; shortlistSize?: number } = {},
): Promise<PlacementResult> {
  const shortlist = rankPlacementCandidates(change, capabilities, options.shortlistSize);
  if (!options.model || shortlist.length === 0) return { shortlist };

  const pick = await options.model({ change, shortlist, capabilities });
  const [top, runnerUp] = shortlist;
  const clearLeader = runnerUp === undefined || runnerUp.score < top.score;
  return { shortlist, model: { pick, agrees: clearLeader && pick === top.id } };
}
