/**
 * Plan pipeline: rules, then the text pass, then the Jev pass.
 *
 * Reads the source once, runs the migration's rules, then each model pass the
 * migration defines and the context supplies a seam for. A model pass asks one
 * question per item; an answer recorded in the earlier plan is reused when the
 * pass, the model and the hash of the item's content and question all match,
 * so only new or changed items reach the seam. A seam error stops the asking,
 * keeps the answers so far and marks the pass `incomplete` in the header; later
 * passes do not run, and the plan must not be applied. A pass that did not run
 * carries the earlier plan's answers unchanged (its header lists no record for
 * it); the hash and model check on the next run still decides reuse. The migration's
 * `summarize`, when it has one, then rebuilds the summary from the final
 * entries. Writes nothing: the caller
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

  let stopped = false;
  for (const name of MODEL_PASSES) {
    if (stopped) {
      // Not run, but its earlier answers are kept so the next run still reuses them.
      const kept = previous?.answers[name];
      if (kept) answers[name] = kept;
      continue;
    }
    const pass = migration.passes?.[name];
    const seam = context.seams?.[name];
    if (!pass || !seam) continue;
    const record: PassRecord = { name, model: seam.model };
    passes.push(record);
    const recorded: Record<string, RecordedAnswer> = {};
    const earlier = previous?.answers[name] ?? {};
    for (const q of pass.questions(entries, data, context)) {
      // Own-property lookups: an item id may name an Object.prototype member ("constructor").
      const content = itemHash.get(q.id);
      const entry = Object.hasOwn(entries, q.id) ? entries[q.id] : undefined;
      if (content === undefined || entry === undefined) throw new Error(`${name} pass asked about ${q.id}, which has no source item and entry`);
      if (Object.hasOwn(recorded, q.id)) throw new Error(`${name} pass asked about ${q.id} twice`);
      const hash = answerHash(content, q.question);
      const prior = Object.hasOwn(earlier, q.id) ? earlier[q.id] : undefined;
      let answer: unknown;
      if (prior && prior.hash === hash && prior.model === seam.model) answer = prior.answer;
      else if (record.incomplete) continue; // the seam failed earlier in this pass: ask no more
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
      recorded[q.id] = { hash, model: seam.model, answer };
      entries[q.id] = await pass.merge(entry, answer, { question: q.question, context });
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
