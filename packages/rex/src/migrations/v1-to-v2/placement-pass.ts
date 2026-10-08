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
 * Which passes run is the caller's choice, through {@link placementSeams}: no
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
import type {
  PlacementArea,
  PlacementChange,
  PlacementModel,
  PlacementNode,
  PlacementProposal,
  PlacementTarget,
} from "../../core/placement.js";
import type { PRDItem } from "../../schema/v1.js";
import type { ModelPass, ModelQuestion, PassSeam, PlanContext } from "../migration.js";
import type { ModelPassName } from "../plan-file.js";
import { placementChangeOf, type PlanEntry } from "./migration-plan.js";

/** What a placement question carries: every input the answer depends on. */
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

const TIERS: Record<ModelPassName, readonly PlacementModels[]> = { text: ["text", "both"], jev: ["jev", "both"] };

function settingsOf(context: PlanContext<PlacementPassOptions | undefined>): PlacementSettings {
  return context.options?.placement ?? DEFAULT_PLACEMENT_SETTINGS;
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
  if (!TIERS[pass].includes(settingsOf(context).models)) return [];
  const byId = itemsById(items);
  const { nodes, areas } = productOf(entries, byId);
  const out: ModelQuestion[] = [];
  for (const e of Object.values(entries)) {
    const item = byId.get(e.id);
    if (!item || !isHeldChange(e)) continue;
    const question: PlacementQuestion = { kind: "placement", change: placementChangeOf(item), nodes, areas };
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
async function rawTextAnswer(q: PlacementQuestion, place: PlacementModel): Promise<TextPlacementAnswer> {
  let raw: TextPlacementAnswer = null;
  const model: PlacementModel = async (input) => (raw = await place(input));
  await decidePlacement(q.change, q.nodes, { settings: { models: "text", autoAccept: "none" }, model, areas: q.areas });
  return raw;
}

/** Ask Jev through `decidePlacement` and return the raw answer; null when the empty shortlist left nothing to ask. */
async function rawJevAnswer(q: PlacementQuestion, ask: PlacementJudge): Promise<JevPlacementAnswer> {
  let raw: JevPlacementAnswer = null;
  const judge: PlacementJudge = async (request, opts) => {
    const response = await ask(request, opts);
    raw = { model: response.model, answers: response.answers };
    return response;
  };
  await decidePlacement(q.change, q.nodes, { settings: { models: "jev", autoAccept: "none" }, judge, jevAvailable: true, areas: q.areas });
  return raw;
}

export interface PlacementSeamOptions {
  /** `rex.placement`; decides which tiers get a seam. */
  settings?: PlacementSettings;
  /** Rules only: no model pass runs, whatever is configured. */
  rulesOnly?: boolean;
  /** The text tier (see `createTextPlacementModel`). Absent means no text model is available. */
  text?: { model: string; place: PlacementModel };
  /** The Jev tier, `askJev`-shaped. */
  jev?: { model: string; judge: PlacementJudge };
  /** False without a TypeSafe key; the caller reads env. */
  jevAvailable?: boolean;
}

/** The pipeline seams for placement: a pass gets one only when its tier is configured and available. */
export function placementSeams(options: PlacementSeamOptions): Partial<Record<ModelPassName, PassSeam>> {
  if (options.rulesOnly) return {};
  const { models } = options.settings ?? DEFAULT_PLACEMENT_SETTINGS;
  const seams: Partial<Record<ModelPassName, PassSeam>> = {};
  const { text, jev } = options;
  if (text && TIERS.text.includes(models)) {
    seams.text = { model: text.model, ask: (q) => rawTextAnswer(asPlacementQuestion(q.question), text.place) };
  }
  if (jev && options.jevAvailable !== false && TIERS.jev.includes(models)) {
    seams.jev = { model: jev.model, ask: (q) => rawJevAnswer(asPlacementQuestion(q.question), jev.judge) };
  }
  return seams;
}
