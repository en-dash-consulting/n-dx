/**
 * Migration plan, Jev review: optional judgments, a confidence per entry, and
 * the review queue.
 *
 * Jev sends one request per item, batching that item's independent questions,
 * in two stages: held changes before the specs are drafted
 * ({@link jevHeldPass}), everything else after ({@link jevReviewPass}).
 *
 * - a held change (`needsPlacement`): its placement choice
 *   (`./placement-pass.ts`, when Jev places) and a kind choice: area,
 *   capability, constraint or change;
 * - an area: a noul, is its title named for a job a user does;
 * - a drafted capability: a noul per criterion (product behaviour, not
 *   process) and a noul per test link (does the test exercise the criterion).
 *
 * Review is off unless the Jev seam lists {@link REVIEW_QUESTION_KIND}:
 * `planSeams` (`./seams.ts`) does so for `rex.placement.models` jev or both, or
 * the `jevReview` option, and only with a TypeSafe key.
 *
 * A choice's confidence is Jev's own; a noul's is its distance from undecided,
 * |2p − 1|. An entry Jev judged carries the lowest confidence of its answers.
 *
 * Acceptance follows `rex.placement.autoAccept`, as placement does. A test
 * link Jev judges irrelevant is dropped only under `confident`, at or above
 * `PLACEMENT_JEV_MIN_CONFIDENCE`; the rules linked it, so under `agree` Jev's no
 * is a disagreement and the link stays, flagged. A kind other than the rules'
 * and a process criterion are flagged, never applied: retargeting restructures
 * the tree and dropping a criterion renumbers the spec, so a person decides.
 * After a drop, review is re-checked as after any redraft (`stampReview`):
 * `reviewedHash` stays only while the spec's hash is the approved one. Links
 * are not hashed, so a drop alone keeps an approved spec reviewed; the drop
 * itself is noted on the spec.
 *
 * @module migrations/v1-to-v2/jev-review-pass
 */

import type { ChoiceAnswer, JevAnswer, JevRequest, JevResponse, JsonValue, NoulAnswer } from "@n-dx/llm-client";
import { PLACEMENT_JEV_MIN_CONFIDENCE, type PlacementJudge } from "../../core/placement-policy.js";
import type { ItemLevel, PRDItem } from "../../schema/v1.js";
import type { ModelPass, ModelQuestion, PlanContext } from "../migration.js";
import { evidenceNotes, indexItems, linkedTestsOf, type CapabilitySpecDraft, type SpecCriterion } from "./capability-spec.js";
import { stampReview, type ItemPlanData } from "./migration-plan-data.js";
import type { PlanEntry, ProposedArea } from "./migration-plan.js";
import { placementJevPass, rawJevAnswer, settingsOf, type PlacementFields, type PlacementPassOptions, type PlacementQuestion } from "./placement-pass.js";
import type { SpecFields, SpecPassOptions } from "./spec-pass.js";

/** The question kind a Jev seam must list in `kinds` to be asked for review. */
export const REVIEW_QUESTION_KIND = "review";

/** Task class of a Jev request that carries review questions. */
export const MIGRATION_JUDGE_TASK_CLASS = "prd.migrate.judge";

/** Below this probability of yes, Jev reads the answer as no. */
const NOUL_YES = 0.5;

export const KIND_CHOICES = ["area", "capability", "constraint", "change"] as const;
export type KindChoice = (typeof KIND_CHOICES)[number];

const KIND_CRITERIA: Record<KindChoice, string> = {
  area: "A part of the product named for a job its users do; it holds capabilities and constraints.",
  capability: "Something the product does today that a user or caller can rely on.",
  constraint: "A standing rule every change in its scope must keep (performance, security, compatibility).",
  change: "A piece of work that alters the product: it is done once and then closes.",
};

/** What a review question carries: every input the answers depend on. */
export interface ReviewQuestion {
  /** A held item: asks its kind. */
  held?: { title: string; level: ItemLevel; description: string | null };
  /** An area: asks whether its title names a job. */
  area?: { title: string; description: string | null };
  /** A drafted capability: asks about each criterion and each test link. */
  capability?: {
    title: string;
    statement: string | null;
    criteria: Array<{ id: string; text: string }>;
    links: Array<{ criterion: string; test: string }>;
  };
}

/** One Jev request about one item. */
export interface JevBundleQuestion {
  kind: "jev";
  placement?: PlacementQuestion;
  review?: ReviewQuestion;
}

/** The Jev seam's raw answer; null when nothing was asked (an empty placement shortlist and no review). */
export type JevBundleAnswer = Pick<JevResponse, "model" | "answers"> | null;

/** A noul as recorded on an entry. */
export interface NoulJudgment {
  /** Probability of yes. */
  probability: number;
  /** |2p − 1|. */
  confidence: number;
}

export interface TestLinkJudgment extends NoulJudgment {
  criterion: string;
  test: string;
  /** Removed from the criterion and its requirement. */
  dropped: boolean;
}

/** What Jev said about an entry. */
export interface JevReview {
  kind?: { choice: string; confidence: number };
  /** Areas: is the title named for a job a user does. */
  jobShaped?: NoulJudgment;
  /** Capabilities: per criterion id, is it product behaviour rather than process. */
  criteria?: Record<string, NoulJudgment>;
  /** Capabilities: per linked test, does it exercise the criterion. */
  testLinks?: TestLinkJudgment[];
}

/** Entry fields the review writes. */
export interface JevReviewFields {
  jevReview?: JevReview;
  /** Lowest confidence of Jev's answers about the entry; absent when Jev did not judge it. */
  confidence?: number;
}

export interface ReviewQueueItem {
  id: string;
  held: boolean;
  /** Listed as reviewed, but the draft is not the spec the reviewer approved (`reviewNote`). */
  specChanged?: true;
  confidence?: number;
}

/** Plan-wide counts of what the review flagged and dropped. */
export interface JevReviewSummary {
  droppedTestLinks: number;
  flaggedTestLinks: number;
  flaggedCriteria: number;
  flaggedAreas: number;
  /** Items Jev reads as a different kind than the rules gave them. */
  otherKind: number;
}

type Entry = PlanEntry & PlacementFields & SpecFields & JevReviewFields & { data?: ItemPlanData };
type Options = (PlacementPassOptions & SpecPassOptions) | undefined;

const noulConfidence = (p: number): number => Math.abs(2 * p - 1);

const linkKey = (i: number): string => `l${i + 1}`;

// ── Questions ────────────────────────────────────────────────────

function reviewEnabled(context: PlanContext<Options>): boolean {
  const seam = context.seams?.jev;
  return seam !== undefined && (seam.kinds === undefined || seam.kinds.includes(REVIEW_QUESTION_KIND));
}

function reviewQuestionOf(entry: Entry, item: PRDItem | undefined): ReviewQuestion | undefined {
  const description = item?.description ?? null;
  if (entry.needsPlacement === true) return { held: { title: entry.title, level: entry.level, description } };
  if (entry.target === "area") return { area: { title: entry.title, description } };
  const spec = entry.spec;
  if (entry.target !== "capability" || !spec || spec.criteria.length === 0) return undefined;
  return {
    capability: {
      title: spec.title,
      statement: spec.statement ?? null,
      criteria: spec.criteria.map((c) => ({ id: c.id, text: c.text })),
      links: spec.criteria.flatMap((c) => (c.tests ?? []).map((test) => ({ criterion: c.id, test }))),
    },
  };
}

/** The Jev request for a review question. Question ids are for code; Jev reads the instructions. */
export function reviewRequest(review: ReviewQuestion): JevRequest {
  const state: Record<string, JsonValue> = {};
  const questions: JevRequest["questions"] = {};
  if (review.held) {
    state.item = review.held;
    questions.kind = {
      type: "choice",
      instructions: "In a product map, what is `item`? Read its title and description, not its level.",
      criteria: KIND_CRITERIA,
    };
  }
  if (review.area) {
    state.area = review.area;
    questions.job = {
      type: "noul",
      instructions:
        'Is `area.title` named for a job a user does ("Plan work", "Running agents"), rather than a package, component or theme?',
    };
  }
  if (review.capability) {
    const { title, statement, criteria, links } = review.capability;
    state.capability = { title, statement };
    state.criteria = Object.fromEntries(criteria.map((c) => [c.id, c.text]));
    state.links = Object.fromEntries(links.map((l, i) => [linkKey(i), l]));
    for (const c of criteria) {
      questions[`criterion:${c.id}`] = {
        type: "noul",
        instructions: `Does \`criteria.${c.id}\` state product behaviour a user or caller can observe, rather than process (tests pass, docs updated, code reviewed)?`,
      };
    }
    links.forEach((_, i) => {
      const key = linkKey(i);
      questions[`link:${key}`] = {
        type: "noul",
        instructions: `Does the test file \`links.${key}.test\` exercise the criterion in \`criteria\` that \`links.${key}.criterion\` names?`,
      };
    });
  }
  return { state, questions };
}

function joinRequests(a: JevRequest, b: JevRequest): JevRequest {
  const stateA = a.state as Record<string, JsonValue>;
  const stateB = b.state as Record<string, JsonValue>;
  for (const key of Object.keys(stateB)) if (Object.hasOwn(stateA, key)) throw new Error(`Jev request state key ${key} is asked twice`);
  for (const key of Object.keys(b.questions)) if (Object.hasOwn(a.questions, key)) throw new Error(`Jev question ${key} is asked twice`);
  return { state: { ...stateA, ...stateB }, questions: { ...a.questions, ...b.questions } };
}

function isBundle(question: unknown): question is JevBundleQuestion {
  return (question as { kind?: unknown } | null)?.kind === "jev";
}

function answerOf<T extends JevAnswer["type"]>(
  answers: Record<string, JevAnswer>,
  id: string,
  type: T,
): Extract<JevAnswer, { type: T }> {
  const answer = Object.hasOwn(answers, id) ? answers[id] : undefined;
  if (!answer || answer.type !== type) throw new Error(`Jev review answer ${id} is missing or not a ${type}`);
  const values = type === "noul" ? [(answer as NoulAnswer).noul] : [(answer as ChoiceAnswer).confidence];
  if (!values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error(`Jev review answer ${id} is not in [0, 1]`);
  if (type === "choice" && !(KIND_CHOICES as readonly string[]).includes((answer as ChoiceAnswer).choice)) {
    throw new Error(`Jev review answer ${id} chose ${(answer as ChoiceAnswer).choice}, not a kind`);
  }
  return answer as Extract<JevAnswer, { type: T }>;
}

/** Every review question in `request` has an answer of its type. */
function checkReviewAnswers(request: JevRequest, answers: Record<string, JevAnswer>): void {
  for (const [id, q] of Object.entries(request.questions)) answerOf(answers, id, q.type);
}

/**
 * Ask Jev one item's questions in one request: the placement choice through
 * `decidePlacement`, with the review questions joined to it. Returns the raw
 * answer; a response missing a review answer is an error, so it is never recorded.
 */
export async function askJevBundle(question: unknown, judge: PlacementJudge): Promise<JevBundleAnswer> {
  if (!isBundle(question)) throw new Error("not a Jev question");
  const review = question.review ? reviewRequest(question.review) : undefined;
  const ask: PlacementJudge = review
    ? (request) => judge(joinRequests(request, review), { taskClass: MIGRATION_JUDGE_TASK_CLASS })
    : judge;
  let raw: JevBundleAnswer = question.placement ? await rawJevAnswer(question.placement, ask) : null;
  if (raw === null && review) {
    const response = await judge(review, { taskClass: MIGRATION_JUDGE_TASK_CLASS });
    raw = { model: response.model, answers: response.answers };
  }
  if (review && raw) checkReviewAnswers(review, raw.answers);
  return raw;
}

// ── Merge ────────────────────────────────────────────────────────

function dropLinks(spec: CapabilitySpecDraft, drops: ReadonlyArray<{ criterion: string; test: string }>, testCommand: string | undefined): CapabilitySpecDraft {
  const dropped = (c: SpecCriterion, t: string) => drops.some((d) => d.criterion === c.id && d.test === t);
  const criteria: SpecCriterion[] = [];
  const requirements = [...spec.requirements];
  for (const c of spec.criteria) {
    const tests = (c.tests ?? []).filter((t) => !dropped(c, t));
    if (tests.length === (c.tests ?? []).length) {
      criteria.push(c);
      continue;
    }
    const at = requirements.findIndex((r) => r.id === c.requirement);
    const { requirement: _requirement, tests: _tests, ...rest } = c;
    if (tests.length === 0) {
      if (at >= 0) requirements.splice(at, 1);
      criteria.push(rest);
      continue;
    }
    if (at >= 0) {
      const r = requirements[at]!;
      requirements[at] = {
        ...r,
        description: `Linked to: ${tests.join(", ")}`,
        ...(r.validationCommand !== undefined && testCommand ? { validationCommand: `${testCommand} ${tests.join(" ")}` } : {}),
      };
    }
    criteria.push({ ...rest, ...(c.requirement !== undefined ? { requirement: c.requirement } : {}), tests });
  }
  const next = { ...spec, criteria, requirements, tests: linkedTestsOf(criteria) };
  const stale = new Set(evidenceNotes(spec));
  const notes = spec.notes.filter((n) => !stale.has(n));
  for (const d of drops) notes.push(`Jev judged ${d.test} does not exercise ${d.criterion}: link dropped`);
  return { ...next, notes: [...notes, ...evidenceNotes(next)] };
}

function mergeReview(entry: Entry, review: ReviewQuestion, answer: JevBundleAnswer, context: PlanContext<Options>): Entry {
  if (answer === null) throw new Error(`no recorded Jev review answer for ${entry.id}`);
  const { answers } = answer;
  const jevReview: JevReview = {};
  const reasons = [...entry.reasons];
  let next: Entry = entry;

  if (review.held) {
    const kind = answerOf(answers, "kind", "choice");
    jevReview.kind = { choice: kind.choice, confidence: kind.confidence };
    if (kind.choice !== entry.target) {
      reasons.push(`Jev reads it as a ${kind.choice} (confidence ${kind.confidence}): changing its kind needs a person`);
    }
  }
  if (review.area) {
    const p = answerOf(answers, "job", "noul").noul;
    jevReview.jobShaped = { probability: p, confidence: noulConfidence(p) };
  }
  if (review.capability && entry.spec) {
    const { autoAccept } = settingsOf(context);
    const criteria: Record<string, NoulJudgment> = {};
    const notes: string[] = [];
    for (const c of review.capability.criteria) {
      const p = answerOf(answers, `criterion:${c.id}`, "noul").noul;
      criteria[c.id] = { probability: p, confidence: noulConfidence(p) };
      if (p < NOUL_YES) notes.push(`Jev reads ${c.id} as process, not product behaviour (p ${p}): confirm or remove it`);
    }
    const testLinks = review.capability.links.map((l, i): TestLinkJudgment => {
      const p = answerOf(answers, `link:${linkKey(i)}`, "noul").noul;
      const confidence = noulConfidence(p);
      const dropped = p < NOUL_YES && autoAccept === "confident" && confidence >= PLACEMENT_JEV_MIN_CONFIDENCE;
      if (p < NOUL_YES && !dropped) notes.push(`Jev doubts ${l.test} exercises ${l.criterion} (p ${p}): confirm the link`);
      return { ...l, probability: p, confidence, dropped };
    });
    jevReview.criteria = criteria;
    jevReview.testLinks = testLinks;

    const drops = testLinks.filter((l) => l.dropped);
    let spec = drops.length > 0 ? dropLinks(entry.spec, drops, context.options?.testCommand) : entry.spec;
    if (notes.length > 0) spec = { ...spec, notes: [...spec.notes, ...notes] };
    next = { ...next, spec, ...(entry.data ? { data: stampReview(entry.data, spec) } : {}) };
  }
  return { ...next, reasons, jevReview };
}

function lowestConfidence(entry: Entry): number | undefined {
  const r = entry.jevReview;
  const placement = entry.modelPlacement?.models.jev !== undefined ? entry.modelPlacement.jev?.confidence : undefined;
  const all = [
    placement,
    r?.kind?.confidence,
    r?.jobShaped?.confidence,
    ...Object.values(r?.criteria ?? {}).map((c) => c.confidence),
    ...(r?.testLinks ?? []).map((l) => l.confidence),
  ].filter((c): c is number => c !== undefined);
  return all.length > 0 ? Math.min(...all) : undefined;
}

/**
 * One bundled Jev question per item that has a placement or review question,
 * among the held entries (`held`) or the rest. Placement questions come from
 * `placementJevPass` and are only ever about held entries.
 */
function jevPassOver(held: boolean): ModelPass<readonly PRDItem[], Entry, Options> {
  return {
    questions(entries, items, context) {
      const placements = held
        ? new Map(placementJevPass.questions(entries, items, context).map((q) => [q.id, q.question as PlacementQuestion]))
        : new Map<string, PlacementQuestion>();
      const review = reviewEnabled(context);
      const byId = review ? indexItems(items) : new Map<string, PRDItem>();
      const out: ModelQuestion[] = [];
      for (const e of Object.values(entries)) {
        if ((e.needsPlacement === true) !== held) continue;
        const placement = placements.get(e.id);
        const r = review ? reviewQuestionOf(e, byId.get(e.id)) : undefined;
        if (!placement && !r) continue;
        const question: JevBundleQuestion = { kind: "jev", ...(placement ? { placement } : {}), ...(r ? { review: r } : {}) };
        out.push({ id: e.id, question });
      }
      return out;
    },
    async merge(entry, answer, { question, context }) {
      if (!isBundle(question)) throw new Error(`Jev answer for ${entry.id} to a question that is not a Jev question`);
      const raw = answer as JevBundleAnswer;
      let next = entry;
      if (question.placement) next = await placementJevPass.merge(next, raw, { question: question.placement, context });
      if (question.review) next = mergeReview(next, question.review, raw, context);
      const confidence = lowestConfidence(next);
      return confidence === undefined ? next : { ...next, confidence };
    },
  };
}

/** The Jev pass over held changes: placement, when Jev places, and the kind question. Runs before specs are drafted. */
export const jevHeldPass = jevPassOver(true);

/**
 * The Jev pass over everything else: areas and drafted capabilities. Runs
 * after the text pass redrafts the specs, so it reviews the final drafts.
 */
export const jevReviewPass = jevPassOver(false);

// ── Summary ──────────────────────────────────────────────────────

/**
 * Held items first, then entries Jev judged or whose approved spec changed, by
 * ascending confidence; plan order breaks ties. Unjudged entries lead their group.
 */
export function reviewQueue(entries: Readonly<Record<string, Entry>>): ReviewQueueItem[] {
  const queued = Object.values(entries)
    .filter((e) => e.needsPlacement === true || e.confidence !== undefined || e.data?.reviewNote !== undefined)
    .map((e) => ({
      id: e.id,
      held: e.needsPlacement === true,
      ...(e.data?.reviewNote !== undefined ? { specChanged: true as const } : {}),
      ...(e.confidence !== undefined ? { confidence: e.confidence } : {}),
    }));
  const rank = (q: ReviewQueueItem) => q.confidence ?? -1;
  return queued.sort((a, b) => Number(b.held) - Number(a.held) || rank(a) - rank(b));
}

/** An area with Jev's job-shaped probability and, below even odds, a note. */
export function withJevArea(area: ProposedArea, entry: Entry | undefined): ProposedArea {
  const judged = entry?.jevReview?.jobShaped;
  if (!judged) return area;
  const notes = judged.probability < NOUL_YES
    ? [...area.notes, `Jev reads the title as not named for a job a user does (p ${judged.probability})`]
    : area.notes;
  return { ...area, jevJobShaped: judged.probability, notes };
}

/** Counts across the plan; undefined when Jev reviewed nothing. */
export function jevReviewSummary(entries: Readonly<Record<string, Entry>>): JevReviewSummary | undefined {
  const reviewed = Object.values(entries).filter((e) => e.jevReview !== undefined);
  if (reviewed.length === 0) return undefined;
  const summary: JevReviewSummary = { droppedTestLinks: 0, flaggedTestLinks: 0, flaggedCriteria: 0, flaggedAreas: 0, otherKind: 0 };
  for (const e of reviewed) {
    const r = e.jevReview!;
    for (const l of r.testLinks ?? []) {
      if (l.dropped) summary.droppedTestLinks += 1;
      else if (l.probability < NOUL_YES) summary.flaggedTestLinks += 1;
    }
    summary.flaggedCriteria += Object.values(r.criteria ?? {}).filter((c) => c.probability < NOUL_YES).length;
    if (r.jobShaped && r.jobShaped.probability < NOUL_YES) summary.flaggedAreas += 1;
    if (r.kind && r.kind.choice !== e.target) summary.otherKind += 1;
  }
  return summary;
}
