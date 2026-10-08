/**
 * Plan pipeline: rules, then the text pass, then the Jev pass.
 *
 * Reads the source once, runs the migration's rules, then each model pass the
 * migration defines and the context supplies a seam for. A model pass asks one
 * question per item; an answer recorded in the earlier plan is reused when the
 * pass, the model and the hash of the item's content and question all match,
 * so only new or changed items reach the seam. Writes nothing: the caller
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

  const { entries, summary } = migration.rules(data, context);
  const passes: PassRecord[] = [{ name: "rules" }];
  const answers: PlanFile<TEntry, TSummary>["answers"] = {};

  for (const name of MODEL_PASSES) {
    const pass = migration.passes?.[name];
    const seam = context.seams?.[name];
    if (!pass || !seam) continue;
    passes.push({ name, model: seam.model });
    const recorded: Record<string, RecordedAnswer> = {};
    const earlier = previous?.answers[name] ?? {};
    for (const q of pass.questions(entries, data)) {
      const content = itemHash.get(q.id);
      const entry = entries[q.id];
      if (content === undefined || entry === undefined) throw new Error(`${name} pass asked about ${q.id}, which has no source item and entry`);
      if (q.id in recorded) throw new Error(`${name} pass asked about ${q.id} twice`);
      const hash = answerHash(content, q.question);
      const prior = earlier[q.id];
      const answer = prior && prior.hash === hash && prior.model === seam.model ? prior.answer : await seam.ask(q);
      recorded[q.id] = { hash, model: seam.model, answer };
      entries[q.id] = pass.merge(entry, answer);
    }
    answers[name] = recorded;
  }

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
    summary,
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
