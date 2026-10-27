/** Read-only, deterministic prose comparison of v1-to-v2 plan decisions. */
import { z } from "zod";
import { contentHash } from "./migration.js";
import type { PlanFile } from "./plan-file.js";

const KINDS = ["area", "capability", "constraint", "change", "task", "subtask", "release"] as const;
const EntrySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  target: z.enum(KINDS),
  parent: z.string().optional(),
  placement: z.string().optional(),
  relation: z.enum(["touches", "amends"]).optional(),
  needsPlacement: z.boolean().optional(),
  data: z.object({
    droppedMeta: z.number().int().nonnegative().optional(),
    droppedLog: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();
type Entry = z.infer<typeof EntrySchema>;
const MOVEMENT = ["target", "parent", "placement", "relation", "needsPlacement"] as const;

function entries(plan: PlanFile): Record<string, Entry> {
  const parsed = z.record(z.string(), EntrySchema).safeParse(plan.entries);
  if (!parsed.success) throw new Error(`Cannot diff plan entries: ${parsed.error.message}`);
  for (const [id, entry] of Object.entries(parsed.data)) {
    if (id !== entry.id) throw new Error(`Cannot diff entry ${id}: its id is ${entry.id}.`);
  }
  return parsed.data;
}

/** Quoted, single-line text also disambiguates titles containing punctuation. */
function name(entry: Entry): string {
  return `${JSON.stringify(entry.title)} (${JSON.stringify(entry.id).slice(1, -1)})`;
}

function destination(entry: Entry): string {
  const parent = entry.parent === undefined ? "at the layer root" : `under ${JSON.stringify(entry.parent).slice(1, -1)}`;
  const placement = (entry.needsPlacement ? "; held for placement" : "") +
    (entry.placement === undefined ? "" : `; ${entry.relation ?? "touches"} ${JSON.stringify(entry.placement)}`);
  // A relation without a placement is still a decision worth reporting.
  const relation = entry.placement === undefined && entry.relation !== undefined ? `; relation ${JSON.stringify(entry.relation)}` : "";
  return `${entry.target} ${parent}${placement}${relation}`;
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter((key) => Object.hasOwn(before, key) !== Object.hasOwn(after, key) || contentHash(before[key]) !== contentHash(after[key]));
}

/** Counts come from entries. Summary.corrupt repeats these totals; never add it. */
function totals(items: Record<string, Entry>) {
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<typeof KINDS[number], number>;
  let meta = 0;
  let log = 0;
  for (const entry of Object.values(items)) {
    counts[entry.target]++;
    meta += entry.data?.droppedMeta ?? 0;
    log += entry.data?.droppedLog ?? 0;
  }
  return { counts, meta, log };
}

/**
 * Compare the decisions that apply will read, keyed by source id. Hash the
 * entry itself, never the recorded answer: its hash covers the question and
 * input, not the decision, and rules-only plans have no recorded answers.
 * Object order, source digest, cut time and the answer cache are not decisions.
 * Plan-wide summary decisions and pass completion are reported separately.
 */
export function diffPlanFiles(before: PlanFile, after: PlanFile): string {
  if (before.header.migration !== "v1-to-v2" || after.header.migration !== before.header.migration ||
      before.header.from !== after.header.from || before.header.to !== after.header.to ||
      before.header.source.kind !== after.header.source.kind) {
    throw new Error("Plans must describe the same migration (v1-to-v2), schema versions and source kind.");
  }
  const oldEntries = entries(before);
  const newEntries = entries(after);
  const lines: string[] = [];
  const changes = { added: 0, dropped: 0, moved: 0, changed: 0 };
  for (const id of [...new Set([...Object.keys(oldEntries), ...Object.keys(newEntries)])].sort()) {
    const old = oldEntries[id];
    const next = newEntries[id];
    if (!old && next) {
      lines.push(`Added ${name(next)}, a ${destination(next)}.`);
      changes.added++;
    } else if (old && !next) {
      lines.push(`Dropped ${name(old)}, a ${destination(old)}.`);
      changes.dropped++;
    } else if (old && next && contentHash(old) !== contentHash(next)) {
      const fields = changedKeys(old, next);
      const moved = fields.some((field) => (MOVEMENT as readonly string[]).includes(field));
      if (moved) {
        const other = fields.filter((field) => !(MOVEMENT as readonly string[]).includes(field));
        lines.push(`Moved ${name(next)} from ${destination(old)} to ${destination(next)}.${other.length ? ` Also changed: ${other.join(", ")}.` : ""}`);
        changes.moved++;
      } else {
        lines.push(`Changed ${name(next)}: ${fields.join(", ")}.`);
        changes.changed++;
      }
    }
  }
  // These aggregates are repeated in entries or recomputed for the report.
  // Everything else in the summary may carry a plan-wide decision.
  const summaryDecisions = (plan: PlanFile): Record<string, unknown> => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(plan.summary);
    if (!parsed.success) throw new Error("Cannot diff plan summary: expected an object.");
    const { counts: _counts, corrupt: _corrupt, flagCounts: _flags, legacyLoe: _loe, evidenceDigest: _digest, ...rest } = parsed.data;
    return rest;
  };
  const summaryFields = changedKeys(summaryDecisions(before), summaryDecisions(after));
  if (summaryFields.length) lines.push(`Plan summary changed: ${summaryFields.join(", ")}.`);
  const completion = (plan: PlanFile) => plan.header.passes.filter((pass) => pass.incomplete).map((pass) => pass.name);
  const oldIncomplete = completion(before);
  const newIncomplete = completion(after);
  if (contentHash(oldIncomplete) !== contentHash(newIncomplete)) {
    lines.push(oldIncomplete.length ? `Before plan is incomplete: ${oldIncomplete.join(", ")}.` : "Before plan is complete.");
    lines.push(newIncomplete.length ? `After plan is incomplete: ${newIncomplete.join(", ")}.` : "After plan is complete.");
  }
  if (!lines.length) return "No differences between migration plans.\n";
  const oldTotals = totals(oldEntries);
  const newTotals = totals(newEntries);
  lines.push(
    `Entries: ${changes.added} added, ${changes.dropped} dropped, ${changes.moved} moved, ${changes.changed} changed.`,
    `Counts by kind: ${KINDS.map((kind) => `${kind} ${oldTotals.counts[kind]} → ${newTotals.counts[kind]}`).join("; ")}.`,
    `Corrupt metadata to drop: recommendationMeta ${oldTotals.meta} → ${newTotals.meta}; log entries ${oldTotals.log} → ${newTotals.log}.`,
  );
  return `${lines.join("\n")}\n`;
}
