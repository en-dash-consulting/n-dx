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
  type PlacementCandidate,
  type PlacementCapability,
  type PlacementChange,
  type PlacementModel,
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
  /** Highest-probability candidate, or null when Jev named none on the shortlist. */
  pick: string | null;
  confidence: number;
  /** Shortlist candidates by Jev probability, best first. */
  ranking: Array<{ id: string; probability: number }>;
}

export interface PlacementDecision {
  /** Rules ranking, best first. */
  shortlist: PlacementCandidate[];
  /** Tiers actually used after degradation; `rules` means no model seam ran. */
  used: PlacementModels | "rules";
  text?: { pick: string | null };
  jev?: JevPlacement;
  /** The capability accepted without a human, or null. */
  accepted: string | null;
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
  capabilities: readonly PlacementCapability[],
): Record<string, string> {
  const byId = new Map(capabilities.map((c) => [c.id, c]));
  const criteria: Record<string, string> = {};
  for (const { id } of shortlist) {
    const cap = byId.get(id);
    criteria[id] = cap?.statement?.trim() || cap?.title || id;
  }
  return criteria;
}

async function askJevPlacement(
  judge: PlacementJudge,
  change: PlacementChange,
  shortlist: readonly PlacementCandidate[],
  capabilities: readonly PlacementCapability[],
): Promise<JevPlacement> {
  const response = await judge(
    {
      state: {
        change: { title: change.title, intent: change.intent ?? null, files: change.files ?? [] },
        shortlist: shortlist.map((c) => ({ id: c.id, score: c.score, reasons: c.reasons })),
      },
      questions: {
        place: {
          type: "choice",
          instructions: "Which capability does `change` amend or touch? The candidates are the rules `shortlist`.",
          criteria: criteriaFor(shortlist, capabilities),
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
    .map(({ id }) => ({ id, probability: answer.probabilities[id] ?? 0 }))
    .sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id));
  const onShortlist = shortlist.some((c) => c.id === answer.choice);
  return { pick: onShortlist ? answer.choice : null, confidence: answer.confidence, ranking };
}

/** Run the configured tiers over a change and decide whether to accept the placement. */
export async function decidePlacement(
  change: PlacementChange,
  capabilities: readonly PlacementCapability[],
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

  const rules = await placeChange(change, capabilities, {
    model: useText ? options.model : undefined,
    shortlistSize: options.shortlistSize,
  });
  const { shortlist } = rules;
  const jev =
    useJev && options.judge && shortlist.length > 0
      ? await askJevPlacement(options.judge, change, shortlist, capabilities)
      : undefined;

  const top = shortlist[0];
  // A tied top score names no single rules leader, so nothing "agrees" with it.
  const clearLeader = top !== undefined && (shortlist[1] === undefined || shortlist[1].score < top.score);
  const textAgrees = rules.model?.agrees === true;
  const jevAgrees = clearLeader && jev?.pick === top?.id;

  let accepted: string | null = null;
  if (top && settings.autoAccept === "agree") {
    const ok = used !== "rules" && (!useText || textAgrees) && (!useJev || jevAgrees);
    if (ok) accepted = top.id;
  } else if (settings.autoAccept === "confident") {
    if (!useJev) {
      warnings.push('rex.placement.autoAccept "confident" needs Jev; nothing is auto-accepted');
    } else if (jev?.pick && jev.confidence >= PLACEMENT_JEV_MIN_CONFIDENCE) {
      accepted = jev.pick;
    }
  }

  return {
    shortlist,
    used,
    ...(rules.model ? { text: { pick: rules.model.pick } } : {}),
    ...(jev ? { jev } : {}),
    accepted,
    needsPlacement: accepted === null,
    warnings,
  };
}
