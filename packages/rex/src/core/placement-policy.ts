/**
 * Placement policy: which models run and when a placement is accepted.
 *
 * Rules always run (see ./placement.ts). `rex.placement.models` chooses which
 * injected seams are called on top of them, and `rex.placement.autoAccept`
 * chooses when a pick is accepted without a human. The decision is pure: the
 * text model and the Jev judge are injected, and `decidePlacement` reads no
 * env, network, judgment cache or observer. Only `loadPlacementSettings`
 * touches disk, through `loadProjectOverrides`.
 *
 * @module core/placement-policy
 */

import { loadProjectOverrides } from "@n-dx/llm-client";
import type { JevRequest, JevResponse } from "@n-dx/llm-client";
import {
  placeChange,
  placementRelation,
  type PlacementCandidate,
  type PlacementChange,
  type PlacementModel,
  type PlacementNode,
  type PlacementProposal,
  type PlacementRelation,
  type PlacementTarget,
} from "./placement.js";

export type PlacementModels = "text" | "jev" | "both";
export type PlacementAutoAccept = "none" | "agree" | "confident";

export interface PlacementSettings {
  models: PlacementModels;
  autoAccept: PlacementAutoAccept;
}

export const DEFAULT_PLACEMENT_SETTINGS: PlacementSettings = { models: "text", autoAccept: "agree" };

/** Task class for the Jev placement question. Not a default judgment route. */
export const PLACEMENT_JUDGE_TASK_CLASS = "prd.place.judge";

/** `autoAccept: confident` accepts a Jev pick at or above this confidence. */
export const PLACEMENT_JEV_MIN_CONFIDENCE = 0.8;

/**
 * Reserved choice key for "none of these". Node ids are slugs or UUIDs
 * and never start with underscores, so it cannot collide with one.
 */
export const PLACEMENT_NONE_OF_THESE = "__none_of_these__";

/** Section of `.n-dx.json` that holds rex settings (`rex.placement.*`). */
const REX_CONFIG_KEY = "rex";

const MODELS: readonly PlacementModels[] = ["text", "jev", "both"];
const AUTO_ACCEPT: readonly PlacementAutoAccept[] = ["none", "agree", "confident"];

/** Injected Jev seam, same shape as `askJev` in @n-dx/llm-client. */
export type PlacementJudge = (request: JevRequest, opts?: { taskClass?: string }) => Promise<JevResponse>;

/** Read `rex.placement` from a parsed `rex` config section; invalid values fall back to the default with a warning. */
export function parsePlacementSettings(rexSection: Record<string, unknown>): {
  settings: PlacementSettings;
  warnings: string[];
} {
  const raw = rexSection.placement;
  const section = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const warnings: string[] = [];
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = section[key];
    if (value === undefined) return fallback;
    if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
    warnings.push(
      `rex.placement.${key}: ${JSON.stringify(value)} is not one of ${allowed.join(", ")}; using "${fallback}"`,
    );
    return fallback;
  };
  return {
    settings: {
      models: pick("models", MODELS, DEFAULT_PLACEMENT_SETTINGS.models),
      autoAccept: pick("autoAccept", AUTO_ACCEPT, DEFAULT_PLACEMENT_SETTINGS.autoAccept),
    },
    warnings,
  };
}

/** Load placement settings from the `.n-dx.json` next to `rexDir` (the `.rex` directory). */
export async function loadPlacementSettings(rexDir: string) {
  return parsePlacementSettings(await loadProjectOverrides(rexDir, REX_CONFIG_KEY));
}

export interface JevPlacement {
  /** Jev's chosen target, or null when it named none on the shortlist. Jev picks the target, never the relation. */
  pick: string | null;
  /** True when Jev chose none-of-these: never accepted, never counts as agreeing. */
  abstained: boolean;
  confidence: number;
  /** Shortlist candidates by Jev probability, best first; the relation is the rules'. */
  ranking: Array<PlacementTarget & { probability: number }>;
}

export interface PlacementDecision {
  /** Rules ranking, best first. */
  shortlist: PlacementCandidate[];
  /** Tiers actually used after degradation; `rules` means no model seam ran. */
  used: PlacementModels | "rules";
  text?: { pick: string | null };
  jev?: JevPlacement;
  /** The rules' relation for this change; every candidate and the accepted placement carry it. */
  relation: PlacementRelation;
  /** The placement accepted without a human, or null. */
  accepted: PlacementTarget | null;
  /** A new node the text model proposed. Never auto-accepted: it always leaves needsPlacement set. */
  proposal?: PlacementProposal;
  /** True whenever no placement was accepted; the change waits for a decision. */
  needsPlacement: boolean;
  warnings: string[];
}

export interface DecidePlacementOptions {
  settings?: PlacementSettings;
  /** Text model seam (task class `prd.place`). */
  model?: PlacementModel;
  /** Jev seam. Absent means Jev is unavailable. */
  judge?: PlacementJudge;
  /** False when there is no TYPESAFE_API_KEY; the caller decides, this module never reads env. */
  jevAvailable?: boolean;
  shortlistSize?: number;
}

function criteriaFor(
  shortlist: readonly PlacementCandidate[],
  nodes: readonly PlacementNode[],
): Record<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const criteria: Record<string, string> = {};
  for (const { target } of shortlist) {
    const node = byId.get(target);
    criteria[target] = node?.statement?.trim() || node?.title || target;
  }
  criteria[PLACEMENT_NONE_OF_THESE] = "None of the listed capabilities or constraints fits this change.";
  return criteria;
}

async function askJevPlacement(
  judge: PlacementJudge,
  change: PlacementChange,
  shortlist: readonly PlacementCandidate[],
  nodes: readonly PlacementNode[],
  warnings: string[],
): Promise<JevPlacement> {
  const response = await judge(
    {
      state: {
        change: { title: change.title, intent: change.intent ?? null, files: change.files ?? [] },
        shortlist: shortlist.map((c) => ({ id: c.target, score: c.score, reasons: c.reasons })),
      },
      questions: {
        place: {
          type: "choice",
          instructions:
            "Which capability or constraint does `change` amend or touch? The candidates are the rules `shortlist`.",
          criteria: criteriaFor(shortlist, nodes),
        },
      },
    },
    { taskClass: PLACEMENT_JUDGE_TASK_CLASS },
  );
  const answer = response.answers.place;
  if (!answer || answer.type !== "choice") {
    throw new Error("Jev placement answer is missing or not a choice");
  }
  const ranking = shortlist
    .map(({ target, relation }) => ({ target, relation, probability: answer.probabilities[target] ?? 0 }))
    .sort((a, b) => b.probability - a.probability || a.target.localeCompare(b.target));
  const abstained = answer.choice === PLACEMENT_NONE_OF_THESE;
  const onShortlist = shortlist.some((c) => c.target === answer.choice);
  // The shared parser accepts any number; a malformed confidence must not clear the band.
  const validConfidence = Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1;
  if (!validConfidence) {
    warnings.push(`Jev placement confidence ${String(answer.confidence)} is not a finite number in [0, 1]; ignoring its pick`);
  }
  return {
    pick: onShortlist && validConfidence ? answer.choice : null,
    abstained,
    confidence: answer.confidence,
    ranking,
  };
}

/** Run the configured tiers over a change and decide whether to accept the placement. */
export async function decidePlacement(
  change: PlacementChange,
  nodes: readonly PlacementNode[],
  options: DecidePlacementOptions = {},
): Promise<PlacementDecision> {
  const settings = options.settings ?? DEFAULT_PLACEMENT_SETTINGS;
  const warnings: string[] = [];
  const jevReady = options.jevAvailable !== false && options.judge !== undefined;

  let used: PlacementModels | "rules" = settings.models;
  if (settings.models !== "text" && !jevReady) {
    if (settings.models === "both") {
      used = "text";
      warnings.push('rex.placement.models is "both" but Jev is unavailable (no TYPESAFE_API_KEY); using the text model only');
    } else {
      used = "rules";
      warnings.push('rex.placement.models is "jev" but Jev is unavailable (no TYPESAFE_API_KEY); using rules only');
    }
  }
  const useText = used === "text" || used === "both";
  const useJev = used === "jev" || used === "both";
  if (useText && !options.model) warnings.push("no text model supplied; the text tier did not run");

  const rules = await placeChange(change, nodes, {
    model: useText ? options.model : undefined,
    shortlistSize: options.shortlistSize,
  });
  warnings.push(...rules.warnings);
  const { shortlist } = rules;
  const relation = placementRelation(change);
  const jev =
    useJev && options.judge && shortlist.length > 0
      ? await askJevPlacement(options.judge, change, shortlist, nodes, warnings)
      : undefined;

  const top = shortlist[0];
  // A tied top score names no single rules leader, so nothing "agrees" with it.
  const clearLeader = top !== undefined && (shortlist[1] === undefined || shortlist[1].score < top.score);
  const textAgrees = rules.model?.agrees === true;
  const jevAgrees = clearLeader && jev?.pick === top?.target;
  const proposal = rules.model?.proposal;

  let acceptedTarget: string | null = null;
  if (top && settings.autoAccept === "agree") {
    const ok = used !== "rules" && (!useText || textAgrees) && (!useJev || jevAgrees);
    if (ok) acceptedTarget = top.target;
  } else if (settings.autoAccept === "confident") {
    if (!useJev) {
      warnings.push('rex.placement.autoAccept "confident" needs Jev; nothing is auto-accepted');
    } else if (jev?.pick && jev.confidence >= PLACEMENT_JEV_MIN_CONFIDENCE) {
      acceptedTarget = jev.pick;
    }
  }
  // A proposed new node is a product decision: no autoAccept mode takes it, or anything else, past a person.
  if (proposal) {
    acceptedTarget = null;
    warnings.push(`text model proposed a new ${proposal.type} "${proposal.title}" under "${proposal.under}"; needs a human placement`);
  }

  if (jev?.abstained) warnings.push("Jev abstained (none of the shortlisted capabilities or constraints fits); needs a human placement");

  const accepted = acceptedTarget === null ? null : { target: acceptedTarget, relation };
  return {
    shortlist,
    used,
    ...(rules.model ? { text: { pick: rules.model.pick } } : {}),
    ...(jev ? { jev } : {}),
    relation,
    accepted,
    ...(proposal ? { proposal } : {}),
    needsPlacement: accepted === null,
    warnings,
  };
}
