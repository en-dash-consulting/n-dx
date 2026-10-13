/**
 * Migration plan, review rendering: the plan file as Markdown a person reads.
 *
 * The JSON plan file (`../plan-file.ts`) is what `apply` will read; this is
 * what a reviewer reads before approving it. The two are written together by
 * `rex migrate-plan` from one plan object, so the prose can never describe a
 * different plan than the one that would be applied.
 *
 * Pure and deterministic, like every other stage: a function of the plan
 * alone. It reads no clock — the cut time comes from the plan header — so the
 * same plan renders byte-identically every time.
 *
 * Deliberately lossy and one-way, in the same sense as the narrative PRD
 * export: nothing parses it back. Every field needed to apply the plan is in
 * the JSON beside it.
 *
 * @module migrations/v1-to-v2/plan-summary
 */

import type { PlanFile } from "../plan-file.js";
import type { V1ToV2Entry, V1ToV2Summary } from "./index.js";
import type { PlanTargetType } from "./migration-plan.js";

export type V1ToV2Plan = PlanFile<V1ToV2Entry, V1ToV2Summary>;

/** Targets in the order the counts table lists them; a target absent from the plan still gets a row. */
const TARGET_ORDER: readonly PlanTargetType[] = ["area", "capability", "constraint", "change", "task", "subtask", "release"];

/**
 * A table cell: backslashes and pipes escaped, newlines flattened, so one long
 * description cannot break the row. Backslashes go first: a title ending in `\`
 * before a pipe would otherwise read as `\|`, an escaped pipe, and swallow the
 * column boundary.
 */
function cell(value: string | undefined): string {
  const text = (value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .trim();
  return text === "" ? "—" : text;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

/** `rules; text (claude-sonnet-5-5); jev (jev-latest) — incomplete: <error>`. */
function passLine(plan: V1ToV2Plan): string {
  return plan.header.passes
    .map((p) => {
      const name = p.model === undefined ? p.name : `${p.name} (${p.model})`;
      return p.incomplete ? `${name} — incomplete: ${p.incomplete.error}` : name;
    })
    .join("; ");
}

/** What a change was placed on, and how, for the items table. */
function placement(entry: V1ToV2Entry, titles: ReadonlyMap<string, string>): string {
  if (entry.needsPlacement) return "held for review";
  if (entry.placement === undefined) return "";
  const relation = entry.relation ? `${entry.relation} ` : "";
  return `${relation}${titles.get(entry.placement) ?? entry.placement}`;
}

/** Every flag a reviewer should see on one item: data flags, then the plan-level ones. */
function flags(entry: V1ToV2Entry): string {
  const out: string[] = [...(entry.data?.flags ?? [])];
  if (entry.applied) out.push("applied");
  if (entry.data?.reviewNote) out.push("spec-changed");
  if (entry.data?.legacyLoe) out.push("legacy-loe");
  return out.join(", ");
}

/**
 * The plan as a review document.
 *
 * Opens with what was planned and by which passes, so a reviewer handed the
 * file alone can tell whether a model ran and whether it finished. An
 * incomplete pass is called out before anything else: that plan must not be
 * applied, and burying it under four tables is how it gets applied anyway.
 */
export function renderPlanSummary(plan: V1ToV2Plan): string {
  const { header, summary } = plan;
  const entries = Object.values(plan.entries);
  const titles = new Map(entries.map((e) => [e.id, e.title]));
  const lines: string[] = [];

  lines.push(`# Migration plan: ${header.from} → ${header.to}`, "");
  lines.push(`- Migration: \`${header.migration}\``);
  lines.push(`- Source: \`${header.source.kind}\` \`${header.source.digest.slice(0, 12)}\``);
  lines.push(`- Cut at: ${header.cutAt}`);
  lines.push(`- Passes: ${passLine(plan)}`, "");

  const incomplete = header.passes.filter((p) => p.incomplete);
  if (incomplete.length > 0) {
    lines.push(
      `> **Do not apply this plan.** The ${incomplete.map((p) => p.name).join(" and ")} pass stopped on an error, so some items have no answer. Re-run the plan to continue from the answers already recorded.`,
      "",
    );
  }

  lines.push("## Counts", "");
  lines.push(...table(["Target", "Items"], TARGET_ORDER.map((t) => [t, String(summary.counts[t] ?? 0)])), "");

  lines.push("## Proposed areas", "");
  if (summary.areas.length === 0) {
    lines.push("None: no epic classified as an area.", "");
  } else {
    lines.push(
      ...table(
        ["Area", "v1 id", "Job-shaped", "Product nodes", "Notes"],
        summary.areas.map((a) => [
          cell(a.title),
          `\`${a.id}\``,
          a.jevJobShaped === undefined ? (a.jobShaped ? "yes" : "no") : `${a.jobShaped ? "yes" : "no"} (Jev ${a.jevJobShaped.toFixed(2)})`,
          String(a.productNodes),
          cell(a.notes.join("; ")),
        ]),
      ),
      "",
    );
  }

  lines.push("## Proposed constraints", "");
  if (summary.constraints.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push(
      ...table(
        ["Constraint", "From", "Applies to"],
        summary.constraints.map((c) => [
          cell(c.title),
          `\`${c.source}\``,
          c.appliesTo === "all" ? "all areas" : cell(titles.get(c.appliesTo) ?? c.appliesTo),
        ]),
      ),
      "",
    );
  }

  if (summary.dissolvedReleases.length > 0) {
    lines.push("## Dissolved release epics", "");
    lines.push(
      "Each becomes a `plannedRelease` on its changes. Its v1 id aliases nothing — a lookup of it in v2 finds no node.",
      "",
    );
    lines.push(
      ...table(
        ["Epic", "v1 id", "Planned release"],
        summary.dissolvedReleases.map((r) => [cell(r.title), `\`${r.id}\``, cell(r.plannedRelease)]),
      ),
      "",
    );
  }

  if (summary.reviewQueue.length > 0) {
    lines.push("## Review queue", "");
    lines.push("Held items first, then the calls a model was least sure of.", "");
    lines.push(
      ...table(
        ["v1 id", "Title", "Why"],
        summary.reviewQueue.map((q) => {
          const why = [
            ...(q.held ? ["held for placement"] : []),
            ...(q.specChanged ? ["spec changed since review"] : []),
            ...(q.confidence === undefined ? [] : [`confidence ${q.confidence.toFixed(2)}`]),
          ];
          return [`\`${q.id}\``, cell(titles.get(q.id)), cell(why.join("; "))];
        }),
      ),
      "",
    );
  }

  lines.push("## Items", "");
  lines.push(
    ...table(
      ["v1 id", "Level", "Title", "Target", "Placement", "Flags"],
      entries.map((e) => [`\`${e.id}\``, e.level, cell(e.title), e.target, cell(placement(e, titles)), cell(flags(e))]),
    ),
    "",
  );

  lines.push("## Data fixes", "");
  const fixes = Object.entries(summary.flagCounts).filter(([, n]) => n > 0);
  lines.push(
    ...table(
      ["Fix", "Items"],
      [
        ...fixes.map(([flag, n]) => [flag, String(n)]),
        ...(summary.legacyLoe > 0 ? [["legacy loe bucket", String(summary.legacyLoe)]] : []),
        ...(summary.corrupt.recommendationMeta > 0 ? [["corrupt recommendationMeta dropped", String(summary.corrupt.recommendationMeta)]] : []),
        ...(summary.corrupt.logEntries > 0 ? [["corrupt log entries dropped", String(summary.corrupt.logEntries)]] : []),
      ],
    ),
    "",
  );

  if (summary.jevReview) {
    const r = summary.jevReview;
    lines.push("## Jev review", "");
    lines.push(
      ...table(
        ["Finding", "Items"],
        [
          ["test links dropped", String(r.droppedTestLinks)],
          ["test links flagged", String(r.flaggedTestLinks)],
          ["criteria flagged", String(r.flaggedCriteria)],
          ["areas flagged", String(r.flaggedAreas)],
          ["read as another kind", String(r.otherKind)],
        ],
      ),
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
