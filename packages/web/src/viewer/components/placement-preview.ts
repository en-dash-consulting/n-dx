/**
 * What a placement or a move will do, drawn before anything is written: the
 * source, an edge to the target labelled with the relation (Touches dashed,
 * Amends solid, Move an arrow out of the old parent), why the target was
 * suggested, and the target before and after.
 *
 * The model is pure ({@link placePreview}, {@link movePreview}) so the place
 * form and the Ask panel's reparent card draw one picture from what they
 * already hold; {@link PlacementPreview} renders it. It recomputes on every
 * render, so a different target or relation redraws it at once, and its
 * {@link PreviewModel.action} is the confirm button's label.
 *
 * @module viewer/components/placement-preview
 */

import { h } from "preact";
import type { PlacementRelation, PlacementStrength } from "../views/product-model.js";
import { StrengthChip } from "./strength-chip.js";

// ── Model ────────────────────────────────────────────────────────────

/** The edge the picture draws: a placement's relation, or a move. */
export type PreviewRelation = PlacementRelation | "move";

/** One end of the edge. */
export interface PreviewEnd {
  title: string;
  /** What it is: change, capability, constraint, task… */
  kind: string;
  /** Where it sits: an area, the Inbox, a parent. */
  detail?: string;
}

/** One line of the before/after; `changed` marks what the write alters. */
export interface PreviewLine {
  text: string;
  changed?: boolean;
}

export interface PreviewModel {
  /** Null while no relation is chosen: the edge is drawn undecided. */
  relation: PreviewRelation | null;
  source: PreviewEnd;
  /** A move's current parent. */
  from?: PreviewEnd;
  target: PreviewEnd;
  /** Rex's strength for a shortlist target; absent for a pick of the person's own. */
  strength?: PlacementStrength;
  /** Why the target was suggested, one reason per line. */
  why: string[];
  before: PreviewLine[];
  after: PreviewLine[];
  /** The confirm button's label: the action and its target. */
  action: string;
}

/** A shortlist reason in words, from rex's `<rule>: <detail>` form. */
export function reasonText(reason: string): string {
  const m = /^([a-z -]+): (.*)$/.exec(reason);
  if (!m) return reason;
  const [, rule, detail] = m;
  switch (rule) {
    case "words": return `Shares the words ${detail}`;
    case "path": return `Names the path ${detail}`;
    case "package": return `Names the package ${detail}`;
    case "file evidence": return `Its files are named: ${detail}`;
    case "code-health finding": return `A code-health finding (${detail})`;
    default: return reason;
  }
}

const RELATION_WORD: Record<PlacementRelation, string> = { touches: "Touches", amends: "Amends" };

/** What the place form holds, as {@link placePreview} reads it. */
export interface PlacePreviewInput {
  changeTitle: string;
  /** Where the change sits now; "Inbox" when absent. */
  changeWhere?: string;
  target: {
    title: string;
    type?: "capability" | "constraint";
    area: string;
    statement?: string;
    criteria?: ReadonlyArray<{ id: string; text: string }>;
    strength?: PlacementStrength;
    reasons?: readonly string[];
  };
  relation: PlacementRelation | null;
  /** True when the target is on rex's shortlist (or the model's pick from it). */
  suggested: boolean;
  /** The model picked this target. */
  byModel?: boolean;
  /** The top matches share a score. */
  tied?: boolean;
  /** Rex's relation for the change, and the rule that chose it. */
  rule?: { relation: PlacementRelation; text: string };
  /** An amendment's edits: replacement statement and criteria delta counts. */
  amendment?: { proposed?: string; added: number; replaced: number; removed: number };
}

function criteriaLine(count: number | undefined): string | null {
  if (count === undefined) return null;
  return count === 1 ? "1 criterion" : `${count} criteria`;
}

/** The picture of placing a change: source → relation → target, why, and before/after. */
export function placePreview(input: PlacePreviewInput): PreviewModel {
  const { changeTitle, target, relation, suggested, amendment } = input;
  const kind = target.type ?? "capability";
  const why: string[] = [];
  if (suggested && target.strength) {
    why.push(`Rex rates it a ${target.strength} match`);
    for (const r of target.reasons ?? []) why.push(reasonText(r));
    if (input.tied) why.push("Tied with another match: their order means nothing");
  } else if (!input.byModel) {
    why.push("Your pick: not on rex's shortlist");
  }
  if (input.byModel) why.push("Picked by the model");
  if (input.rule && relation === input.rule.relation) {
    why.push(`${RELATION_WORD[input.rule.relation]}, by rex's rule: ${input.rule.text}`);
  }

  const count = target.criteria?.length;
  const statement = target.statement ? `Statement: ${target.statement}` : "No statement";
  const before: PreviewLine[] = [{ text: statement }];
  const beforeCriteria = kind === "capability" ? criteriaLine(count) : null;
  if (beforeCriteria) before.push({ text: beforeCriteria });

  let after: PreviewLine[] = [];
  if (relation === "touches") {
    after = [
      ...before.map((l) => ({ text: `${l.text} (unchanged)` })),
      { text: `Touched by ${changeTitle}`, changed: true },
    ];
  } else if (relation === "amends") {
    const proposed = amendment?.proposed?.trim();
    after.push(proposed ? { text: `Statement: ${proposed}`, changed: true } : { text: `${statement} (unchanged)` });
    if (kind === "capability") {
      const added = amendment?.added ?? 0;
      const replaced = amendment?.replaced ?? 0;
      const removed = amendment?.removed ?? 0;
      const edits = [added ? `+${added} added` : "", replaced ? `${replaced} reworded` : "", removed ? `−${removed} removed` : ""].filter(Boolean);
      if (count !== undefined) {
        const next = count + added - removed;
        after.push(edits.length
          ? { text: `${criteriaLine(next)} (${edits.join(", ")})`, changed: true }
          : { text: `${criteriaLine(count)} (unchanged)` });
      } else if (edits.length) {
        after.push({ text: `Criteria: ${edits.join(", ")}`, changed: true });
      }
    }
    after.push({ text: `Amended by ${changeTitle} when it is applied`, changed: true });
  }

  return {
    relation,
    source: { title: changeTitle, kind: "change", detail: input.changeWhere ?? "Inbox" },
    target: { title: target.title, kind, ...(target.area ? { detail: target.area } : {}) },
    ...(suggested && target.strength ? { strength: target.strength } : {}),
    why,
    before,
    after,
    action: relation === "touches" ? `Touch ${target.title}` : relation === "amends" ? `Amend ${target.title}` : "Place",
  };
}

/** What a move reads: the item, the parent it leaves and the one it joins. */
export interface MovePreviewInput {
  title: string;
  kind: string;
  from: string;
  to: string;
  /** Why the move was suggested, in the proposer's words. */
  rationale?: string;
}

/** The picture of moving an item from one parent to another. */
export function movePreview({ title, kind, from, to, rationale }: MovePreviewInput): PreviewModel {
  return {
    relation: "move",
    source: { title, kind },
    from: { title: from, kind: "parent" },
    target: { title: to, kind: "parent" },
    why: rationale?.trim() ? [rationale.trim()] : ["No reason was given"],
    before: [{ text: `Under ${from}` }],
    after: [{ text: `Under ${to}`, changed: true }, { text: `No longer under ${from}`, changed: true }],
    action: `Move to ${to}`,
  };
}

// ── View ─────────────────────────────────────────────────────────────

const EDGE_LABEL: Record<PreviewRelation, string> = { touches: "touches", amends: "amends", move: "moves to" };

function End({ end, role }: { end: PreviewEnd; role: "source" | "target" | "from" }) {
  return h("div", { class: `pp-end pp-${role}` },
    h("span", { class: "pp-kind" }, end.kind),
    h("span", { class: "pp-title" }, end.title),
    end.detail ? h("span", { class: "pp-detail" }, end.detail) : null,
  );
}

function Lines({ label, lines }: { label: string; lines: PreviewLine[] }) {
  return h("div", { class: `pp-side pp-${label.toLowerCase()}` },
    h("div", { class: "pp-side-label" }, label),
    h("ul", null, lines.map((l, i) => h("li", { key: i, class: l.changed ? "is-changed" : undefined }, l.text))),
  );
}

/** The picture: source, edge, target, why, before/after. Nothing in it writes. */
export function PlacementPreview({ model }: { model: PreviewModel }) {
  const relation = model.relation ?? "unset";
  const edge = model.relation ? EDGE_LABEL[model.relation] : "touches or amends?";
  return h("figure", { class: "pp", "data-relation": relation, "aria-label": `What ${model.action} does` },
    h("div", { class: "pp-flow" },
      h(End, { end: model.source, role: "source" }),
      model.from ? h(End, { end: model.from, role: "from" }) : null,
      h("div", { class: "pp-edge", "data-relation": relation, "aria-hidden": "true" },
        h("span", { class: "pp-edge-label" }, edge),
        h("span", { class: "pp-edge-line" }),
      ),
      h(End, { end: model.target, role: "target" }),
    ),
    h("div", { class: "pp-why" },
      h("span", { class: "pp-side-label" }, "Why here"),
      model.strength ? h(StrengthChip, { strength: model.strength }) : null,
      h("ul", null, model.why.map((w, i) => h("li", { key: i }, w))),
    ),
    model.after.length
      ? h("div", { class: "pp-diff" }, h(Lines, { label: "Before", lines: model.before }), h(Lines, { label: "After", lines: model.after }))
      : h("div", { class: "pp-diff-pending" }, "Choose Touches or Amends to see what changes."),
  );
}
