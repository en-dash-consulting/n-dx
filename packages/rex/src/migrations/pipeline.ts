/**
 * Plan pipeline: rules, then the migration's stages in order.
 *
 * Reads the source once, runs the migration's rules, then each stage: a model
 * stage when the context supplies its model's seam, a derive stage always. By
 * default the stages are the text pass, then the Jev pass. Each stage reads the
 * entries as the stages before it left them. A model asks at most one question
 * per item across all its stages, and its answers are recorded in one map; an
 * answer recorded in the earlier plan is reused when the model and the hash of
 * the item's content and question both match, so only new or changed items
 * reach the seam. A seam error stops the asking, keeps the answers so far and
 * marks the model's pass `incomplete` in the header; later model stages do not
 * run (derive stages still do), and the plan must not be applied. An item no
 * stage that ran asked about keeps the earlier plan's answer unchanged (a model
 * none of whose stages ran has no header record); the hash and model check on
 * the next run still decides reuse. The header lists one record per model that
 * ran, text before Jev. The migration's `summarize`, when it has one, then
 * rebuilds the summary from the final entries. Writes nothing: the caller
 * writes the returned plan with `writePlanFile`.
 *
 * @module migrations/pipeline
 */

import {
  contentHash,
  type Migration,
  type MigrationDefinition,
  type MigrationSource,
  type PlanContext,
  type PlanStage,
  type SourceItem,
} from "./migration.js";
import {
  PLAN_FILE_FORMAT,
  PLAN_FILE_VERSION,
  type ModelPassName,
  type PassRecord,
  type PlanFile,
  type RecordedAnswer,
} from "./plan-file.js";

const MODEL_PASSES: readonly ModelPassName[] = ["text", "jev"];

/** Digest of the source: its kind and every item's id and hash, in order. */
export function sourceDigest(kind: string, items: readonly SourceItem[]): string {
  return contentHash([kind, items.map((i) => [i.id, i.hash])]);
}

/** Hash a recorded answer is keyed by: the item's content and the question asked about it. */
export function answerHash(itemHash: string, question: unknown): string {
  return contentHash([itemHash, question]);
}

/** The migration's stages: its own, or one per model pass, text then Jev. */
function stagesOf<TData, TEntry, TSummary, TOptions>(
  migration: MigrationDefinition<TData, TEntry, TSummary, TOptions>,
): readonly PlanStage<TData, TEntry, TOptions>[] {
  if (migration.stages && migration.passes) throw new Error(`migration ${migration.id} defines both passes and stages`);
  if (migration.stages) return migration.stages;
  return MODEL_PASSES.flatMap((model) => {
    const pass = migration.passes?.[model];
    return pass ? [{ model, questions: pass.questions, merge: pass.merge }] : [];
  });
}

export async function runPlanPipeline<TData, TEntry, TSummary, TOptions>(
  migration: MigrationDefinition<TData, TEntry, TSummary, TOptions>,
  source: MigrationSource<TData>,
  context: PlanContext<TOptions>,
): Promise<PlanFile<TEntry, TSummary>> {
  if (Number.isNaN(Date.parse(context.cutAt))) throw new Error(`cutAt is not an ISO time: ${context.cutAt}`);
  const previous = context.previous;
  if (previous && previous.header.migration !== migration.id) {
    throw new Error(`earlier plan is for migration ${previous.header.migration}, not ${migration.id}`);
  }

  const { data, items } = await source.read();
  const itemHash = new Map<string, string>();
  for (const item of items) {
    if (itemHash.has(item.id)) throw new Error(`source ${source.kind} has duplicate item id ${item.id}`);
    itemHash.set(item.id, item.hash);
  }

  const rules = migration.rules(data, context);
  let entries = rules.entries;
  const records = new Map<ModelPassName, PassRecord>();
  const answers: PlanFile<TEntry, TSummary>["answers"] = {};
  // Ids each model was asked about this run, across all its stages.
  const asked = new Map<ModelPassName, Set<string>>(MODEL_PASSES.map((name) => [name, new Set()]));

  let stopped = false;
  for (const stage of stagesOf(migration)) {
    if (!("model" in stage)) {
      entries = stage.derive(entries, data, context);
      continue;
    }
    const name = stage.model;
    const seam = context.seams?.[name];
    if (stopped || !seam) continue;
    let record = records.get(name);
    if (!record) {
      record = { name, model: seam.model };
      records.set(name, record);
    }
    const recorded = (answers[name] ??= {});
    const askedOf = asked.get(name)!;
    const earlier = previous?.answers[name] ?? {};
    for (const q of stage.questions(entries, data, context)) {
      // Own-property lookups: an item id may name an Object.prototype member ("constructor").
      const content = itemHash.get(q.id);
      const entry = Object.hasOwn(entries, q.id) ? entries[q.id] : undefined;
      if (content === undefined || entry === undefined) throw new Error(`${name} pass asked about ${q.id}, which has no source item and entry`);
      if (askedOf.has(q.id)) throw new Error(`${name} pass asked about ${q.id} twice`);
      askedOf.add(q.id);
      const hash = answerHash(content, q.question);
      const prior = Object.hasOwn(earlier, q.id) ? earlier[q.id] : undefined;
      let answer: unknown;
      if (prior && prior.hash === hash && prior.model === seam.model) answer = prior.answer;
      else if (record.incomplete) continue; // the seam failed earlier in this stage: ask no more
      else {
        try {
          answer = await seam.ask(q);
        } catch (err) {
          // Keep what was paid for; the caller writes the plan and the next run reuses it.
          record.incomplete = { error: err instanceof Error ? err.message : String(err) };
          stopped = true;
          continue;
        }
      }
      recorded[q.id] = { hash, model: seam.model, answer } satisfies RecordedAnswer;
      entries[q.id] = await stage.merge(entry, answer, { question: q.question, context });
    }
  }
  if (stopped) {
    // Stages that did not run keep their earlier answers, so the next run still reuses them.
    for (const name of MODEL_PASSES) {
      const kept = previous?.answers[name];
      if (!kept) continue;
      const askedOf = asked.get(name)!;
      for (const [id, answer] of Object.entries(kept)) {
        if (!askedOf.has(id)) (answers[name] ??= {})[id] = answer;
      }
    }
  }
  const passes: PassRecord[] = [{ name: "rules" }, ...MODEL_PASSES.flatMap((name) => records.get(name) ?? [])];
  const summary = rules.summary;

  return {
    format: PLAN_FILE_FORMAT,
    version: PLAN_FILE_VERSION,
    header: {
      migration: migration.id,
      from: migration.from,
      to: migration.to,
      source: { kind: source.kind, digest: sourceDigest(source.kind, items) },
      cutAt: context.cutAt,
      passes,
    },
    summary: migration.summarize ? migration.summarize(entries, summary, context) : summary,
    entries,
    answers,
  };
}

/** A migration whose `plan` runs the pipeline over its definition. */
export function defineMigration<TData, TEntry, TSummary, TOptions = undefined>(
  definition: MigrationDefinition<TData, TEntry, TSummary, TOptions>,
): Migration<TData, TEntry, TSummary, TOptions> {
  return {
    id: definition.id,
    from: definition.from,
    to: definition.to,
    plan: (source, context) => runPlanPipeline(definition, source, context),
  };
}
