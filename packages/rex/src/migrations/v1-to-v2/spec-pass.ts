/**
 * Migration plan, spec drafting: the text pass over capability specs.
 *
 * The rules draft each capability's spec from a template
 * (`./capability-spec.ts`). When the text seam drafts specs, this pass asks it
 * to redraft each one, grounded only in what the question carries: the
 * capability's own item, its applied history, the sourcevision code files and
 * the tests the template linked. The question carries every input the answer
 * depends on, so a recorded answer is reused only while they all hold.
 *
 * `merge` checks the answer against the question, never trusting it:
 *
 * - a statement that is not present tense keeps the template statement;
 * - a criterion must cite the source item it came from, one of the
 *   capability's sources. One that does not is rejected, and the template
 *   criteria of every source no accepted criterion cites are kept, with a note;
 * - a test the question did not pass in is not linked;
 * - process criteria (tests pass, docs updated) are left out, as in the template.
 *
 * With no answer, or no spec seam, the template draft stands.
 *
 * @module migrations/v1-to-v2/spec-pass
 */

import type { PRDItem } from "../../schema/v1.js";
import type { ModelPass, ModelQuestion, PlanContext } from "../migration.js";
import {
  asSentence,
  assembleCriteria,
  evidenceNotes,
  indexItems,
  isPresentTenseStatement,
  linkedTestsOf,
  NO_STATEMENT_NOTE,
  toEars,
  type CapabilitySpecDraft,
  type CriterionCandidate,
} from "./capability-spec.js";
import { stampReview, type ItemPlanData } from "./migration-plan-data.js";
import type { PlanEntry } from "./migration-plan.js";

/** The question kind a seam must list in `kinds` to be asked for specs. */
export const SPEC_QUESTION_KIND = "spec";

/** A source item as the model sees it: its own words, nothing derived. */
export interface SpecSourceItem {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
}

/** What a spec question carries: every input the answer depends on. */
export interface SpecQuestion {
  kind: typeof SPEC_QUESTION_KIND;
  capability: SpecSourceItem;
  /** Applied history: completed changes placed on the capability and their completed descendants. */
  history: SpecSourceItem[];
  codeFiles: string[];
  /** Tests the template linked; the only tests an answer may cite. */
  tests: string[];
}

/** The model's raw answer. */
export interface SpecAnswer {
  /** Present-tense statement of what the product does; null when the sources do not say. */
  statement: string | null;
  criteria: { text: string; source?: string; tests?: string[] }[];
}

/** The text tier's spec drafter. */
export type SpecModel = (question: SpecQuestion) => Promise<SpecAnswer>;

/** Entry fields the spec pass reads and writes. */
export interface SpecFields {
  spec?: CapabilitySpecDraft;
  data?: ItemPlanData;
}

/** Migration options the spec pass reads. */
export interface SpecPassOptions {
  testCommand?: string;
}

type Entry = PlanEntry & SpecFields;

function sourceItem(item: PRDItem): SpecSourceItem {
  return {
    id: item.id,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.acceptanceCriteria?.length ? { acceptanceCriteria: [...item.acceptanceCriteria] } : {}),
  };
}

/** The spec question for a drafted capability. */
export function specQuestion(spec: CapabilitySpecDraft, byId: ReadonlyMap<string, PRDItem>): SpecQuestion {
  const [capability, ...history] = spec.sources.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`spec source ${id} is not in the v1 tree`);
    return sourceItem(item);
  });
  return { kind: SPEC_QUESTION_KIND, capability: capability!, history, codeFiles: [...spec.codeFiles], tests: [...spec.tests] };
}

export function isSpecQuestion(question: unknown): question is SpecQuestion {
  return (question as { kind?: unknown } | null)?.kind === SPEC_QUESTION_KIND;
}

function asSpecAnswer(answer: unknown): SpecAnswer {
  const a = answer as Partial<SpecAnswer> | null;
  const statementOk = a?.statement === null || typeof a?.statement === "string";
  if (!a || !statementOk || !Array.isArray(a.criteria)) throw new Error("not a spec answer");
  return a as SpecAnswer;
}

/** The template criteria as candidates again, with the tests their requirements link. */
function templateCandidates(draft: CapabilitySpecDraft): CriterionCandidate[] {
  return draft.criteria.map((c) => ({ text: c.text, raw: c.text, source: c.source, tests: c.tests ?? [] }));
}

const ENSURE_THE_SYSTEM = /^the system shall ensure that the system\s+/i;

/**
 * "The system shall ensure that the system keeps X" is a model habit, not a
 * behaviour: keep the verb phrase and let {@link toEars} restore "The system
 * shall keep X". A phrase whose verb it cannot recognise keeps "shall" as is.
 */
function dropEnsureThatTheSystem(text: string): string {
  const rest = text.trim().replace(ENSURE_THE_SYSTEM, "");
  if (rest === text.trim()) return text;
  const ears = toEars(rest);
  return ears.startsWith("The system shall ensure that ") ? `The system shall ${rest.replace(/[.\s]+$/, "")}.` : ears;
}

/**
 * The template draft redrafted with a model answer. Pure: the same draft,
 * question and answer always give the same spec.
 */
export function redraftSpec(
  draft: CapabilitySpecDraft,
  question: SpecQuestion,
  answer: SpecAnswer,
  model: string,
  testCommand?: string,
): CapabilitySpecDraft {
  const notes: string[] = [];
  const sources = new Set(draft.sources);
  const passedTests = new Set(question.tests);

  let statement = draft.statement;
  const proposed = answer.statement?.trim();
  if (proposed && isPresentTenseStatement(proposed)) statement = asSentence(proposed);
  else if (proposed) notes.push(`the model's statement is not present tense ("${proposed}"): kept the template statement`);
  if (statement === undefined) notes.push(NO_STATEMENT_NOTE);

  const accepted: CriterionCandidate[] = [];
  let rejected = 0;
  for (const c of answer.criteria) {
    const text = typeof c?.text === "string" ? c.text.trim() : "";
    if (!text) continue;
    const source = typeof c.source === "string" ? c.source : undefined;
    if (source === undefined || !sources.has(source)) {
      rejected += 1;
      notes.push(
        source === undefined
          ? `rejected the model criterion "${text}": it cites no source`
          : `rejected the model criterion "${text}": it cites ${source}, outside the capability's sources`,
      );
      continue;
    }
    const tests: string[] = [];
    for (const t of Array.isArray(c.tests) ? c.tests : []) {
      if (passedTests.has(t)) tests.push(t);
      else notes.push(`the model linked ${String(t)}, which the question did not pass in: not linked`);
    }
    accepted.push({ text: toEars(dropEnsureThatTheSystem(text)), raw: text, source, tests });
  }

  // A rejected criterion, or none kept, falls back to the template for every source no accepted criterion cites.
  const kept = assembleCriteria(draft.capability, accepted, testCommand);
  let candidates = accepted;
  if (rejected > 0 || (kept.criteria.length === 0 && draft.criteria.length > 0)) {
    const cited = new Set(kept.criteria.map((c) => c.source));
    const fallback = templateCandidates(draft).filter((c) => !cited.has(c.source));
    if (fallback.length > 0) {
      const from = [...new Set(fallback.map((c) => c.source))].join(", ");
      notes.push(`kept the template criteria from ${from}`);
      candidates = [...accepted, ...fallback];
    }
  }

  const { criteria, requirements } = assembleCriteria(draft.capability, candidates, testCommand);
  const spec: CapabilitySpecDraft = {
    capability: draft.capability,
    title: draft.title,
    ...(statement !== undefined ? { statement } : {}),
    criteria,
    requirements,
    sources: [...draft.sources],
    codeFiles: [...draft.codeFiles],
    tests: linkedTestsOf(criteria),
    draftedBy: model,
    notes: [],
  };
  spec.notes = [...notes, ...evidenceNotes(spec)];
  return spec;
}

/** The spec text pass: one question per drafted capability, when the text seam drafts specs. */
export const specTextPass: ModelPass<readonly PRDItem[], Entry, SpecPassOptions | undefined> = {
  questions(entries, items, context) {
    const seam = context.seams?.text;
    if (!seam || (seam.kinds && !seam.kinds.includes(SPEC_QUESTION_KIND))) return [];
    const byId = indexItems(items);
    const out: ModelQuestion[] = [];
    for (const e of Object.values(entries)) {
      if (e.target === "capability" && e.spec) out.push({ id: e.id, question: specQuestion(e.spec, byId) });
    }
    return out;
  },
  merge(entry, answer, { question, context }) {
    if (!entry.spec || !isSpecQuestion(question)) throw new Error(`spec answer for ${entry.id}, which has no spec draft`);
    const model = modelOf(context);
    const spec = redraftSpec(entry.spec, question, asSpecAnswer(answer), model, context.options?.testCommand);
    // Reviewed only if the redraft is the spec the reviewer approved.
    const data = entry.data ? stampReview(entry.data, spec) : undefined;
    return { ...entry, spec, ...(data ? { data } : {}) };
  },
};

function modelOf(context: PlanContext<unknown>): string {
  const seam = context.seams?.text;
  if (!seam) throw new Error("spec answer without a text seam");
  return seam.model;
}
