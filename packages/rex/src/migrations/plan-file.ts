/**
 * Migration plan file: the reviewable output of planning a migration.
 *
 * A migration plans, a person reviews the plan file, then the migration
 * applies it. The file is JSON, two-space indented, newline-terminated, with
 * its top-level keys in this order:
 *
 * ```jsonc
 * {
 *   "format": "ndx-migration-plan",
 *   "version": 1,
 *   "header": {
 *     "migration": "v1-to-v2",          // registry id of the migration
 *     "from": "v1", "to": "v2",         // schema versions it moves between
 *     "source": {
 *       "kind": "rex-v1-tree",          // the source adapter that was read
 *       "digest": "<sha256 hex>"        // of the source items: their ids and content hashes, in order
 *     },
 *     "cutAt": "2026-10-08T00:00:00.000Z", // caller-supplied ISO time; the only clock the plan reads
 *     "passes": [                       // in run order; rules always, a model pass only when it ran
 *       { "name": "rules" },
 *       { "name": "text", "model": "<model id>" },
 *       { "name": "jev", "model": "<model id>" }
 *     ]
 *   },
 *   "summary": { … },                   // migration-defined, plan-wide (counts, proposed areas, …)
 *   "entries": {                        // one per source item, keyed by its id (v1 item id for v1-to-v2)
 *     "<item id>": { … }                // migration-defined
 *   },
 *   "answers": {                        // model answers, per pass, keyed by item id
 *     "text": {
 *       "<item id>": {
 *         "hash": "<sha256 hex>",       // of the item's content hash and the question asked
 *         "model": "<model id>",
 *         "answer": …                   // what the seam returned, as JSON
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * Re-planning with an earlier plan reuses a recorded answer when the pass,
 * model and hash all match, so an unchanged item is not asked again. Only
 * answers used by this plan are recorded. The writer adds nothing time- or
 * environment-dependent: the same source, options, `cutAt` and answers give
 * byte-identical files.
 *
 * @module migrations/plan-file
 */

import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

export const PLAN_FILE_FORMAT = "ndx-migration-plan";
export const PLAN_FILE_VERSION = 1;

/** The passes a plan runs, in order. */
export const PASS_NAMES = ["rules", "text", "jev"] as const;
export type PassName = (typeof PASS_NAMES)[number];
/** The passes that call a model through a seam. */
export type ModelPassName = Exclude<PassName, "rules">;

export interface PassRecord {
  name: PassName;
  /** Model id; model passes only. */
  model?: string;
}

export interface PlanHeader {
  migration: string;
  from: string;
  to: string;
  source: { kind: string; digest: string };
  cutAt: string;
  passes: PassRecord[];
}

export interface RecordedAnswer {
  hash: string;
  model: string;
  answer: unknown;
}

export interface PlanFile<TEntry = unknown, TSummary = unknown> {
  format: typeof PLAN_FILE_FORMAT;
  version: typeof PLAN_FILE_VERSION;
  header: PlanHeader;
  summary: TSummary;
  entries: Record<string, TEntry>;
  answers: Partial<Record<ModelPassName, Record<string, RecordedAnswer>>>;
}

const PassRecordSchema = z
  .object({ name: z.enum(PASS_NAMES), model: z.string().min(1).optional() })
  .strict()
  .refine((p) => (p.name === "rules") === (p.model === undefined), "a model pass names its model; the rules pass names none");

const RecordedAnswerSchema = z
  .object({ hash: z.string().min(1), model: z.string().min(1), answer: z.unknown() })
  .strict()
  .refine((a) => "answer" in a, "a recorded answer holds an answer");

const PlanFileSchema = z
  .object({
    format: z.literal(PLAN_FILE_FORMAT),
    version: z.literal(PLAN_FILE_VERSION),
    header: z
      .object({
        migration: z.string().min(1),
        from: z.string().min(1),
        to: z.string().min(1),
        source: z.object({ kind: z.string().min(1), digest: z.string().min(1) }).strict(),
        cutAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "cutAt is an ISO time"),
        passes: z.array(PassRecordSchema).refine((p) => p[0]?.name === "rules", "the rules pass runs first"),
      })
      .strict(),
    summary: z.unknown(),
    entries: z.record(z.string(), z.unknown()),
    answers: z
      .object({
        text: z.record(z.string(), RecordedAnswerSchema).optional(),
        jev: z.record(z.string(), RecordedAnswerSchema).optional(),
      })
      .strict(),
  })
  .strict();

/** The plan as file text. Top-level and header keys are written in a fixed order. */
export function formatPlanFile(plan: PlanFile): string {
  const { header } = plan;
  const ordered = {
    format: plan.format,
    version: plan.version,
    header: {
      migration: header.migration,
      from: header.from,
      to: header.to,
      source: { kind: header.source.kind, digest: header.source.digest },
      cutAt: header.cutAt,
      passes: header.passes.map((p) => (p.model === undefined ? { name: p.name } : { name: p.name, model: p.model })),
    },
    summary: plan.summary,
    entries: plan.entries,
    answers: plan.answers,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Parse plan file text. Throws, naming the problem, when the text is not a plan file this version reads. */
export function parsePlanFile(text: string): PlanFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`not a migration plan file: ${(err as Error).message}`);
  }
  const parsed = PlanFileSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`not a migration plan file: ${problems}`);
  }
  return parsed.data as PlanFile;
}

export async function writePlanFile(path: string, plan: PlanFile): Promise<void> {
  await writeFile(path, formatPlanFile(plan), "utf8");
}

export async function readPlanFile(path: string): Promise<PlanFile> {
  return parsePlanFile(await readFile(path, "utf8"));
}
