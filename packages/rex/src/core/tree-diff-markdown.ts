/**
 * `rex tree-diff` as a pull-request comment: plain CommonMark that any code
 * host renders and any CI can post.
 *
 * Host-neutral by construction: headings, bullet lists and inline code only.
 * No HTML, no tables, no task lists, no host markers (no mentions, issue refs
 * or emoji shortcodes), and nothing about where it will be posted.
 *
 * Pure: no I/O. Bounded: each section lists at most {@link MAX_LISTED} entries
 * and says how many it left out, so a large restructure cannot exceed a host's
 * comment size limit.
 *
 * @module core/tree-diff-markdown
 */

import type { DiffEntry, DiffItemRef, TreeDiff } from "./tree-diff.js";
import type { MapDiff, MapEntry } from "./map-diff.js";

/** Entries listed per section before the rest are summarised as a count. */
export const MAX_LISTED = 50;

export interface TreeDiffMarkdownInput {
  fromLabel: string;
  toLabel: string;
  diff: TreeDiff;
  /** The product-layer delta; absent when neither side is a v2 tree. */
  map?: MapDiff;
}

/** Text safe to place in running Markdown: specials escaped, whitespace collapsed. */
function text(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[\\`*_[\]<>#|]/g, (c) => `\\${c}`);
}

/** Inline code that survives a backtick in its content. */
function code(value: string): string {
  const safe = value.replace(/\s+/g, " ").trim();
  return safe.includes("`") ? `\`\` ${safe} \`\`` : `\`${safe}\``;
}

const where = (ancestors: ReadonlyArray<string>): string =>
  ancestors.length ? ` — in ${text(ancestors.join(" › "))}` : "";

function list<T>(heading: string, entries: readonly T[], line: (entry: T) => string): string[] {
  if (entries.length === 0) return [];
  const out = ["", `#### ${heading} (${entries.length})`, ""];
  for (const e of entries.slice(0, MAX_LISTED)) out.push(`- ${line(e)}`);
  if (entries.length > MAX_LISTED) out.push(`- …and ${entries.length - MAX_LISTED} more`);
  return out;
}

const mapLine = (e: MapEntry): string =>
  `${text(e.title)} (${e.type} ${code(e.displayId ?? e.id.slice(0, 8))})${where(e.ancestors)}`;

const itemLine = (e: DiffEntry): string =>
  `${text(e.title)} (${e.level} ${code(e.id.slice(0, 8))})${where(e.ancestors.map((a: DiffItemRef) => a.title))}`;

const show = (v: string | null): string => {
  if (v === null) return "(none)";
  const collapsed = v.replace(/\s+/g, " ").trim();
  return text(collapsed.length > 60 ? `${collapsed.slice(0, 57)}…` : collapsed);
};

function mapSection(map: MapDiff): string[] {
  const { added, modified, retired } = map.counts;
  const out = ["", "### Product map", "", `${added} added · ${modified} modified · ${retired} retired`];
  if (map.identical) return [...out, "", "No capability changes."];
  out.push(...list("Capabilities added", map.added, mapLine));
  out.push(
    ...list("Capabilities modified", map.modified, (e) => {
      const details = e.fields.map((f) => `${f.field}: ${show(f.from)} → ${show(f.to)}`);
      if (e.criteria) {
        const { added: a, removed: r, changed: c } = e.criteria;
        details.push(`capability criteria: +${a.length} −${r.length} ~${c.length}`);
      }
      return `${mapLine(e)}${details.map((d) => `\n  - ${d}`).join("")}`;
    }),
  );
  out.push(...list("Capabilities retired", map.retired, mapLine));
  return out;
}

function changeSection(diff: TreeDiff): string[] {
  const c = diff.counts;
  const out = [
    "",
    "### Changes",
    "",
    `${c.added} added · ${c.changed} changed · ${c.completed} completed · ${c.moved} moved · ${c.removed} removed`,
  ];
  if (diff.identical) return [...out, "", "No differences."];
  out.push(...list("Added", diff.added, itemLine));
  out.push(...list("Completed", diff.completed, itemLine));
  out.push(
    ...list("Changed", diff.changed, (e) =>
      `${itemLine(e)}${e.fields.map((f) => `\n  - ${f.field}: ${show(f.from)} → ${show(f.to)}`).join("")}`,
    ),
  );
  out.push(...list("Moved", diff.moved, (e) => `${itemLine(e)}\n  - from: ${text(e.fromAncestors.map((a) => a.title).join(" › ") || "(root)")}`));
  out.push(...list("Removed", diff.removed, itemLine));
  return out;
}

/** The comment body, ending in a single newline. */
export function renderTreeDiffMarkdown({ fromLabel, toLabel, diff, map }: TreeDiffMarkdownInput): string {
  const lines = [`## PRD changes: ${code(fromLabel)} → ${code(toLabel)}`];
  if (map) lines.push(...mapSection(map));
  lines.push(...changeSection(diff));
  return `${lines.join("\n")}\n`;
}
