/**
 * Migration plan, enriched placement: the text and Jev passes over held changes.
 *
 * The rules (`./migration-plan.ts`) hold a change with `needsPlacement` when no
 * clear leader places it. These passes ask the configured models about each
 * held change and decide with `decidePlacement` (`core/placement-policy.ts`),
 * so `rex.placement.models` and `rex.placement.autoAccept` mean here what they
 * mean everywhere else.
 *
 * A seam records the model's raw answer, never a decision: the plan file keeps
 * what was paid for, and a re-plan with a different `autoAccept` reuses it.
 * `merge` replays the recorded answers through `decidePlacement`. With
 * `models: both`, the text pass parks its answer on the entry and the Jev pass
 * decides with both; with only one tier running, its own pass decides.
 *
 * Which passes run is the caller's choice, through `planSeams` (`./seams.ts`): no
 * seam, no pass, and the plan is the rules-only plan.
 *
 * @module migrations/v1-to-v2/placement-pass
 */

import type { JevResponse } from "@n-dx/llm-client";
import {
  decidePlacement,
  DEFAULT_PLACEMENT_SETTINGS,
  type PlacementDecision,
  type PlacementJudge,
  type PlacementModels,
  type PlacementSettings,
} from "../../core/placement-policy.js";
import {
  rankPlacementCandidates,
  type PlacementArea,
  type PlacementChange,
  type PlacementModel,
  type PlacementNode,
  type PlacementProposal,
  type PlacementTarget,
} from "../../core/placement.js";
import type { PRDItem } from "../../schema/v1.js";
import type { ModelPass, ModelQuestion, PassSeam, PlanContext } from "../migration.js";
import type { ModelPassName } from "../plan-file.js";
import { placementChangeOf, type PlanEntry } from "./migration-plan.js";

/** The question kind a seam must list in `kinds` to be asked for placements. */
export const PLACEMENT_QUESTION_KIND = "placement";

/**
 * What a placement question carries: every input the answer depends on, and
 * nothing else, because the recorded answer is keyed on it (`answerHash`).
 * `nodes` holds only the rules shortlist's nodes, in full: the models see no
 * other capability, and re-ranking this subset reproduces the shortlist, so a
 * replay decides exactly as the recording did. Renaming any other capability
 * leaves the question, and its paid-for answer, unchanged.
 */
export interface PlacementQuestion {
  kind: "placement";
  change: PlacementChange;
  nodes: PlacementNode[];
  areas: PlacementArea[];
}

/** The text seam's raw answer, as `PlacementModel` returns it. */
export type TextPlacementAnswer = string | null | { propose: PlacementProposal };

/** The Jev seam's raw answer; null when the rules shortlist was empty and Jev was not asked. */
export type JevPlacementAnswer = Pick<JevResponse, "model" | "answers"> | null;

/** How the model passes decided a held change. */
export interface ModelPlacement {
  /** The pass that settled the decision. */
  pass: ModelPassName;
  /** The model each pass that answered used. */
  models: Partial<Record<ModelPassName, string>>;
  /** Tiers `decidePlacement` used after degradation. */
  used: PlacementModels | "rules";
  text?: { pick: string | null };
  jev?: { pick: string | null; confidence: number; abstained: boolean };
  /** A new node the text model proposed; never accepted without a person. */
  proposal?: PlacementProposal;
  accepted: PlacementTarget | null;
  warnings?: string[];
}

/** Entry fields the placement passes write. */
export interface PlacementFields {
  modelPlacement?: ModelPlacement;
  /** The text answer parked for the Jev pass (`models: both`); gone once Jev decides. */
  parkedTextPlacement?: { model: string; answer: TextPlacementAnswer };
}

/** Migration options the placement passes read. */
export interface PlacementPassOptions {
  /** `rex.placement`; the defaults when absent. */
  placement?: PlacementSettings;
}

type Entry = PlanEntry & PlacementFields;

/** The `rex.placement.models` values each model pass serves. */
export const PLACEMENT_TIERS: Record<ModelPassName, readonly PlacementModels[]> = { text: ["text", "both"], jev: ["jev", "both"] };

/** A seam that records the `rex.placement` it was built for (`planSeams` sets it). */
export interface PlacementSeam extends PassSeam {
  placement?: PlacementSettings;
}

/**
 * The effective `rex.placement`. A seam records the settings it was built
 * for, so a caller that passes them only to `planSeams` still gets them;
 * `options.placement` must then agree with it, or the plan fails rather than
 * run a pass under settings its seams were not built for.
 */
export function settingsOf(context: PlanContext<PlacementPassOptions | undefined>): PlacementSettings {
  const given = context.options?.placement;
  const seams: Array<PlacementSeam | undefined> = [context.seams?.text, context.seams?.jev];
  const recorded = seams.find((s) => s?.placement)?.placement;
  if (recorded && given && (recorded.models !== given.models || recorded.autoAccept !== given.autoAccept)) {
    throw new Error(
      `placement settings disagree: seams were built for models ${recorded.models}/autoAccept ${recorded.autoAccept}, options say ${given.models}/${given.autoAccept}`,
    );
  }
  return recorded ?? given ?? DEFAULT_PLACEMENT_SETTINGS;
}

function itemsById(items: readonly PRDItem[], out = new Map<string, PRDItem>()): Map<string, PRDItem> {
  for (const item of items) {
    out.set(item.id, item);
    itemsById(item.children ?? [], out);
  }
  return out;
}

/** Product nodes and areas as the rules see them, in plan order. */
function productOf(entries: Readonly<Record<string, Entry>>, byId: Map<string, PRDItem>) {
  const nodes: PlacementNode[] = [];
  const areas: PlacementArea[] = [];
  for (const e of Object.values(entries)) {
    if (e.target === "area") areas.push({ id: e.id, title: e.title });
    if (e.target !== "capability" && e.target !== "constraint") continue;
    const tags = byId.get(e.id)?.tags;
    nodes.push({ id: e.id, ...(e.target === "constraint" ? { type: "constraint" as const } : {}), title: e.title, ...(tags ? { tags } : {}) });
  }
  return { nodes, areas };
}

function isHeldChange(e: Entry): boolean {
  return e.target === "change" && e.needsPlacement === true && e.placement === undefined;
}

function questionsFor(
  pass: ModelPassName,
  entries: Readonly<Record<string, Entry>>,
  items: readonly PRDItem[],
  context: PlanContext<PlacementPassOptions | undefined>,
): ModelQuestion[] {
  const { models } = settingsOf(context);
  const seam = context.seams?.[pass];
  if (!PLACEMENT_TIERS[pass].includes(models)) {
    if (seam?.kinds?.includes(PLACEMENT_QUESTION_KIND)) {
      throw new Error(`the ${pass} seam answers placement but rex.placement.models is ${models}: the pass would ask nothing`);
    }
    return [];
  }
  if (seam?.kinds && !seam.kinds.includes(PLACEMENT_QUESTION_KIND)) return [];
  const byId = itemsById(items);
  const { nodes: all, areas } = productOf(entries, byId);
  const out: ModelQuestion[] = [];
  for (const e of Object.values(entries)) {
    const item = byId.get(e.id);
    if (!item || !isHeldChange(e)) continue;
    const change = placementChangeOf(item);
    const shortlisted = new Set(rankPlacementCandidates(change, all).map((c) => c.target));
    const question: PlacementQuestion = { kind: "placement", change, nodes: all.filter((n) => shortlisted.has(n.id)), areas };
    out.push({ id: e.id, question });
  }
  return out;
}

function asPlacementQuestion(question: unknown): PlacementQuestion {
  const q = question as Partial<PlacementQuestion> | null;
  if (q?.kind !== "placement") throw new Error("not a placement question");
  return q as PlacementQuestion;
}

/** Fold a decision into the entry: accepted places it, anything else keeps it held. */
function settle(entry: Entry, decision: PlacementDecision, pass: ModelPassName, models: ModelPlacement["models"]): Entry {
  const { parkedTextPlacement: _parked, ...rest } = entry;
  const record: ModelPlacement = {
    pass,
    models,
    used: decision.used,
    ...(decision.text ? { text: decision.text } : {}),
    ...(decision.jev
      ? { jev: { pick: decision.jev.pick, confidence: decision.jev.confidence, abstained: decision.jev.abstained } }
      : {}),
    ...(decision.proposal ? { proposal: decision.proposal } : {}),
    accepted: decision.accepted,
    ...(decision.warnings.length > 0 ? { warnings: decision.warnings } : {}),
  };
  const by = Object.entries(models).map(([p, m]) => `${p} ${m}`).join(", ");
  if (decision.accepted) {
    const { needsPlacement: _held, ...placed } = rest;
    return {
      ...placed,
      placement: decision.accepted.target,
      // The classifier's relation stands (an unbuilt feature amends); the rules' fills a gap.
      relation: entry.relation ?? decision.accepted.relation,
      modelPlacement: record,
      reasons: [...entry.reasons, `placed by the ${pass} pass (${by}) on ${decision.accepted.target}`],
    };
  }
  return {
    ...rest,
    needsPlacement: true,
    modelPlacement: record,
    reasons: [...entry.reasons, `the ${pass} pass (${by}) did not settle placement: held`],
  };
}

function replayJudge(answer: JevPlacementAnswer): PlacementJudge {
  return async () => {
    if (answer === null) throw new Error("no recorded Jev placement answer to replay");
    return answer;
  };
}

async function decideRecorded(
  q: PlacementQuestion,
  settings: PlacementSettings,
  text: TextPlacementAnswer | undefined,
  jev: JevPlacementAnswer | undefined,
): Promise<PlacementDecision> {
  return decidePlacement(q.change, q.nodes, {
    settings,
    model: text === undefined ? undefined : async () => text,
    judge: jev === undefined ? undefined : replayJudge(jev),
    jevAvailable: jev !== undefined,
    areas: q.areas,
  });
}

function modelOf(context: PlanContext<unknown>, pass: ModelPassName): string {
  const seam = context.seams?.[pass];
  if (!seam) throw new Error(`${pass} placement answer without a ${pass} seam`);
  return seam.model;
}

export const placementTextPass: ModelPass<readonly PRDItem[], Entry, PlacementPassOptions | undefined> = {
  questions: (entries, items, context) => questionsFor("text", entries, items, context),
  async merge(entry, answer, { question, context }) {
    const q = asPlacementQuestion(question);
    const text = answer as TextPlacementAnswer;
    const model = modelOf(context, "text");
    const settings = settingsOf(context);
    if (settings.models === "both" && context.seams?.jev) {
      return { ...entry, parkedTextPlacement: { model, answer: text } };
    }
    return settle(entry, await decideRecorded(q, settings, text, undefined), "text", { text: model });
  },
};

export const placementJevPass: ModelPass<readonly PRDItem[], Entry, PlacementPassOptions | undefined> = {
  questions: (entries, items, context) => questionsFor("jev", entries, items, context),
  async merge(entry, answer, { question, context }) {
    const q = asPlacementQuestion(question);
    const parked = entry.parkedTextPlacement;
    const models: ModelPlacement["models"] = { ...(parked ? { text: parked.model } : {}), jev: modelOf(context, "jev") };
    const decision = await decideRecorded(q, settingsOf(context), parked?.answer, answer as JevPlacementAnswer);
    return settle(entry, decision, "jev", models);
  },
};

/** Ask the text tier through `decidePlacement` and return the raw answer. */
export async function rawTextAnswer(question: unknown, place: PlacementModel): Promise<TextPlacementAnswer> {
  const q = asPlacementQuestion(question);
  let raw: TextPlacementAnswer = null;
  const model: PlacementModel = async (input) => (raw = await place(input));
  await decidePlacement(q.change, q.nodes, { settings: { models: "text", autoAccept: "none" }, model, areas: q.areas });
  return raw;
}

/** Ask Jev through `decidePlacement` and return the raw answer; null when the empty shortlist left nothing to ask. */
export async function rawJevAnswer(question: unknown, ask: PlacementJudge): Promise<JevPlacementAnswer> {
  const q = asPlacementQuestion(question);
  let raw: JevPlacementAnswer = null;
  const judge: PlacementJudge = async (request, opts) => {
    const response = await ask(request, opts);
    raw = { model: response.model, answers: response.answers };
    return response;
  };
  await decidePlacement(q.change, q.nodes, { settings: { models: "jev", autoAccept: "none" }, judge, jevAvailable: true, areas: q.areas });
  return raw;
}
