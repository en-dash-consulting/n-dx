/**
 * "Where it goes": placement for an Inbox change, at the top of its detail
 * panel (IB1). `ndx work` skips an Inbox change's tasks until it has a place
 * on the product map, so this is where a person gives it one.
 *
 * Top to bottom: a note with the change's position in the Inbox ("N of M ·
 * Next ›") and, where the caller can open it, "Place on the map ↗" for
 * placement mode on the area view (WF1); rex's shortlist as radio rows; a search over every capability and
 * constraint; the relation (Touches, or Amends with its summary, the target's
 * criteria to edit and an optional replacement statement); and the actions —
 * Place, Place & next, Place & add another (an extra touches, IB3) and
 * "Nothing fits", which swaps in a proposal for a new capability or
 * constraint.
 *
 * Nothing is auto-accepted: every write is a button press, through
 * `POST /api/rex/changes/:id/place` or `/propose`. Rex decides; its refusals
 * show inline in its words, with a hint picked by their `kind`.
 *
 * With `rex.placementDraft` on, "Draft with the model" asks
 * `/placement/draft`: a pick selects its shortlist row, a proposal fills the
 * proposal form, and a note says the model chose. The draft writes nothing.
 *
 * Placement mode renders it wide (`layout: "wide"`) beside the spec map:
 * each candidate is a card with its area, strength, matched words, statement
 * and what Touches and Amends would do, the chosen card holds the relation,
 * and rex's relation is pre-selected only for a strong, untied pick. With
 * Amends chosen the card is the editor (WF5): every edit re-checks through
 * `POST /api/rex/changes/:id/placement/check`, the card shows the Sidecar
 * placement card's dry-run line, and Place waits until rex accepts the check.
 * The section follows a target chosen on the map (`selection`), reports its
 * own choices (`onChoose`) and the pending criteria count (`onPendingCriteria`).
 *
 * In the wide panel, Place & add another keeps an umbrella change open: each
 * extra home is a touches (`/place`), the panel lists the homes with Remove
 * (`/unplace`) until Done, and `onHomes` reports them so the map marks each.
 * "Draft with the model" there adds its pick as a card marked "model", never
 * checked for the person, and only while Sidecar (whose Place lens drafts) is off.
 *
 * Once the change leaves the Inbox the section shrinks to one line naming
 * where it was placed.
 *
 * @module viewer/components/prd-tree/change-placement
 */

import { Fragment, h, type ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useCliName, useFeatureToggle, useProductRead } from "../../hooks/index.js";
import type { SidecarPlacementCheck } from "../../hooks/sidecar.js";
import { CHECK_DEBOUNCE_MS, checkPlacementRequest, dryRunLine } from "../sidecar-placement.js";
import { isAppliedUnplaced, useInbox, type ShortlistRead } from "../../views/inbox.js";
import { Pending } from "../../views/product-pages.js";
import { StrengthChip } from "../strength-chip.js";
import { PlaceWithSidecarButton, PlaceWithSidecarContext } from "../place-with-sidecar.js";
import type {
  CapabilityDetail,
  ChangePlacement,
  ChangeRow,
  PlaceChangeRequest,
  PlaceChangeResult,
  PlacementCriteriaDelta,
  PlacementDraft,
  PlacementRefusalKind,
  PlacementRelation,
  PlacementStrength,
  ProductMap,
  ProposeChangeRequest,
  ProposeChangeResult,
} from "../../views/product-model.js";
import { CriteriaEditor } from "./criteria-editor.js";
import {
  dropPlacementDraft,
  loadPlacementDraft,
  savePlacementDraft,
  type PlaceStepDraft,
  type ProposeStepDraft,
} from "./placement-draft.js";

// ── Title focus after Place & next ───────────────────────────────────

let pendingTitleFocus: string | null = null;

/** Ask the detail panel to focus `id`'s title when it next opens that item. */
export function requestTitleFocus(id: string): void {
  pendingTitleFocus = id;
}

/** True once, when the panel opening `id` should focus its title. */
export function takeTitleFocus(id: string): boolean {
  if (pendingTitleFocus !== id) return false;
  pendingTitleFocus = null;
  return true;
}

// ── Opening the form on a relation ───────────────────────────────────

/** What a caller asked the place form to open with. */
export interface PlacementRequest {
  relation: PlacementRelation;
  target?: PlacementTarget;
}

let pendingPlacement: { changeId: string; request: PlacementRequest } | null = null;

/**
 * Ask the place form to open on `request` when it next opens `changeId` —
 * Quick Add's "Amends…" lands on Where it goes with Amends selected.
 */
export function requestPlacement(changeId: string, request: PlacementRequest): void {
  pendingPlacement = { changeId, request };
}

/** The request for `changeId`, once. */
export function takePlacementRequest(changeId: string): PlacementRequest | null {
  if (pendingPlacement?.changeId !== changeId) return null;
  const { request } = pendingPlacement;
  pendingPlacement = null;
  return request;
}

// ── Model ────────────────────────────────────────────────────────────

/** A node a change can be placed on: a shortlist candidate, or a search pick. */
export interface PlacementTarget {
  target: string;
  /** Absent on a Quick Add preview candidate whose node the server could not read. */
  type?: "capability" | "constraint";
  title: string;
  area: string;
  statement?: string;
  /** Absent when not read yet (a search pick; read on choosing Amends). */
  criteria?: Array<{ id: string; text: string }>;
  strength?: PlacementStrength;
  reasons?: string[];
}

/** A target criterion as the Amends form holds it while it is edited. */
export interface CriterionDraft {
  id: string;
  text: string;
  /** The target's text; absent on a criterion this amendment adds. */
  original?: string;
  removed?: boolean;
}

/** The criteria delta an amendment carries; undefined when nothing changed. */
export function criteriaDelta(drafts: readonly CriterionDraft[]): PlacementCriteriaDelta | undefined {
  const add = drafts.filter((d) => d.original === undefined && !d.removed).map(({ id, text }) => ({ id, text }));
  const replace = drafts
    .filter((d) => d.original !== undefined && !d.removed && d.text !== d.original)
    .map(({ id, text }) => ({ id, text }));
  const remove = drafts.filter((d) => d.original !== undefined && d.removed).map((d) => d.id);
  if (!add.length && !replace.length && !remove.length) return undefined;
  return { ...(add.length ? { add } : {}), ...(replace.length ? { replace } : {}), ...(remove.length ? { remove } : {}) };
}

/** How many criteria the amendment adds less how many it removes. */
export function criteriaCountDelta(drafts: readonly CriterionDraft[]): number {
  return drafts.reduce((n, d) => (d.original === undefined ? n + 1 : d.removed ? n - 1 : n), 0);
}

/** The criteria an amendment would leave its capability with, as the selected block shows it: "12 → 13". */
export function pendingCriteriaNote(count: number, delta: number): string {
  return `${count} → ${count + delta}`;
}

/** The next free `cN` id after every id in `taken`. */
export function nextCriterionId(taken: readonly string[]): string {
  const max = taken.reduce((n, id) => {
    const m = /^c(\d+)$/.exec(id);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
  return `c${max + 1}`;
}

/**
 * rex's top pick is strong and nothing ties it. Only then does placement mode
 * open zoomed into its area and pre-select rex's relation (WF2, WF4).
 */
export function strongUntiedPick(placement: Pick<ChangePlacement, "tied" | "shortlist">): boolean {
  return !placement.tied && placement.shortlist[0]?.strength === "strong";
}

/** What placing with Touches does to the target. */
export function touchesEffect(title: string): string {
  return `Links this change to ${title}. What it promises stays as it is.`;
}

/** What placing with Amends does to the target. */
export function amendsEffect(title: string): string {
  return `Changes what ${title} promises: its statement or criteria change when this change is applied.`;
}

/** The question a wide card asks while no relation is chosen. */
export function relationQuestion(title: string): string {
  return `Does this change alter what ${title} promises?`;
}

/** Where `changeId` sits in the Inbox, and which change follows it. */
export function inboxPosition(order: readonly string[], changeId: string): { index: number; total: number; next: string | null } {
  const index = order.indexOf(changeId);
  const others = order.filter((id) => id !== changeId);
  // After the last one, wrap to the first: the Inbox is a queue to work through.
  const next = index < 0 ? others[0] ?? null : order[index + 1] ?? (others[0] ?? null);
  return { index, total: order.length, next };
}

/** One line naming where a placed change went, or null when it has no place. */
export function placedLine(change: Pick<ChangeRow, "amends" | "touches">): string | null {
  const parts = [
    ...change.amends.map((a) => (a.delta === "added" ? `proposes ${a.title}` : `amends ${a.title}`)),
    ...change.touches.map((t) => `touches ${t.title}`),
  ];
  return parts.length ? `Placed: ${parts.join(", ")}` : null;
}

/** What a refusal asks of the person, by rex's `kind`. */
export const REFUSAL_HINTS: Record<PlacementRefusalKind, string> = {
  "not-a-target": "Choose a capability or constraint from the list or the search.",
  "content-needs-amends": "A replacement statement or criteria edits need Amends.",
  "already-amends": "This change already amends it. Choose another place.",
  "already-proposed": "This change already proposes that. Change the title or the area.",
  "rule-errors": "Fix the change itself first; the message names what is wrong.",
  "nothing-to-modify": "Add or edit a criterion, or write a replacement statement. Or choose Touches.",
  "apply-problems": "Applying the change would fail as it stands. Adjust the amendment.",
  "no-such-change": "The change is gone. Reload the tree.",
  "change-not-open": "A cancelled or deleted change is not placed.",
  "applied-change-amends": "An applied change is placed with Touches only.",
  "not-an-area": "Choose an area to put it under.",
  "empty-title": "Give it a title.",
  "invalid-proposal": "Check the proposal's fields.",
};

export interface Refusal {
  message: string;
  kind?: PlacementRefusalKind;
}

type Answer<T> = { ok: true; result: T } | { ok: false; refusal: Refusal };

async function post<T>(url: string, body: unknown): Promise<Answer<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, result: json as T };
    const message = typeof json?.error === "string" ? json.error : `HTTP ${res.status}`;
    const kind = typeof json?.kind === "string" ? json.kind as PlacementRefusalKind : undefined;
    return { ok: false, refusal: { message, ...(kind ? { kind } : {}) } };
  } catch (err) {
    return { ok: false, refusal: { message: err instanceof Error ? err.message : String(err) } };
  }
}

const changeUrl = (id: string, action: "place" | "propose") => `/api/rex/changes/${encodeURIComponent(id)}/${action}`;

/** Criteria the target owns (not inherited), read for a search pick. */
async function readCriteria(target: string): Promise<Array<{ id: string; text: string }>> {
  const res = await fetch(`/api/rex/product/capability/${encodeURIComponent(target)}`);
  if (!res.ok) return [];
  const body = await res.json() as { capability?: CapabilityDetail };
  return (body.capability?.criteria ?? []).filter((c) => !c.inheritedFrom).map(({ id, text }) => ({ id, text }));
}

// ── Pieces ───────────────────────────────────────────────────────────

function RefusalNote({ refusal }: { refusal: Refusal }) {
  // A draft's 403 carries `feature_disabled`, which has no placement hint.
  const hint = refusal.kind ? REFUSAL_HINTS[refusal.kind] : undefined;
  return h("div", { class: "cp-refusal", role: "alert" },
    h("div", { class: "cp-refusal-message" }, refusal.message),
    hint ? h("div", { class: "cp-refusal-hint", "data-kind": refusal.kind }, hint) : null,
  );
}

/**
 * Rex's dry run of `body`, re-run each time it changes and settles: undefined
 * with no body, null while the check for this body is in flight. An answer for
 * an earlier body never stands for the current one.
 */
function useDryRun(changeId: string, body: PlaceChangeRequest | null): SidecarPlacementCheck | null | undefined {
  const key = body ? JSON.stringify(body) : "";
  const [answer, setAnswer] = useState<{ key: string; check: SidecarPlacementCheck } | null>(null);
  useEffect(() => {
    if (!body) return;
    let live = true;
    const timer = setTimeout(() => {
      void checkPlacementRequest(changeId, { ...body }).then((check) => { if (live) setAnswer({ key, check }); });
    }, CHECK_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [changeId, key]);
  if (!body) return undefined;
  return answer?.key === key ? answer.check : null;
}

/** The Sidecar placement card's dry-run line, with a refusal's hint by kind. */
function DryRunLine({ check }: { check: SidecarPlacementCheck | null }) {
  const refused = check && !check.ok ? check : null;
  const hint = refused ? (REFUSAL_HINTS as Record<string, string | undefined>)[refused.kind] : undefined;
  return h("div", {
    class: `cp-dry-run${refused ? " is-refused" : ""}`,
    role: "status",
    "aria-live": "polite",
    "data-check": check === null ? "checking" : refused ? "refused" : "ok",
    ...(refused ? { "data-kind": refused.kind } : {}),
  },
    h("div", { class: "cp-dry-run-line" }, check ? dryRunLine(check) : "Checking the amendment…"),
    hint ? h("div", { class: "cp-refusal-hint" }, hint) : null,
  );
}

// ── Draft with the model ─────────────────────────────────────────────

/** The toggle every "Draft with the model" entry point reads; the route enforces the same key. */
export const PLACEMENT_DRAFT_FEATURE = "rex.placementDraft";

/** What the model said, as the form notes it. */
export interface DraftNote {
  text: string;
  warnings: string[];
}

/** The note for a draft: who chose, and what. */
export function draftNoteText(draft: PlacementDraft, pickTitle?: string): string {
  const by = draft.model ? `the model (${draft.model})` : "the model";
  if (draft.pick !== undefined) return `Picked by ${by}: ${pickTitle ?? draft.pick}. Check it, then place.`;
  if (draft.proposal) return `Drafted by ${by}. Check it, then propose.`;
  return `No draft from ${by}: nothing on the shortlist fit and it proposed nothing.`;
}

function useDraft(changeId: string) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const run = async (): Promise<PlacementDraft | null> => {
    setBusy(true);
    setRefusal(null);
    const answer = await post<PlacementDraft>(`/api/rex/changes/${encodeURIComponent(changeId)}/placement/draft`, {});
    setBusy(false);
    if (answer.ok) return answer.result;
    setRefusal(answer.refusal);
    return null;
  };
  return { busy, refusal, run };
}

/** A drafted proposal's criteria as the proposal form's one-per-line text. */
function criteriaLines(proposal: ProposeChangeRequest | undefined): string {
  return (proposal?.criteria?.add ?? []).map((c) => c.text).join("\n");
}

function DraftButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return h("button", { type: "button", class: "btn btn-sm cp-draft", disabled: busy, onClick },
    busy ? "Drafting…" : "Draft with the model");
}

function DraftNoteView({ note }: { note: DraftNote }) {
  return h("div", { class: "cp-draft-note", role: "status", "data-draft-source": "model" },
    h("div", null, note.text),
    note.warnings.length ? h("ul", null, note.warnings.map((w) => h("li", { key: w }, w))) : null,
  );
}

function Warnings({ warnings }: { warnings?: string[] }) {
  return warnings?.length
    ? h("div", { class: "cp-warnings", role: "status" },
        h("div", { class: "cp-warnings-label" }, "Placed, with warnings:"),
        h("ul", null, warnings.map((w) => h("li", { key: w }, w))),
      )
    : null;
}

function matched(reasons: readonly string[]): string {
  return reasons.map((r) => r.replace(/^words: /, "matched ")).join(" · ");
}

/** One radio row: a target's title, strength (or kind), area and matched words. */
export function TargetRow({ name, target, checked, onChoose }: {
  name: string;
  target: PlacementTarget;
  checked: boolean;
  onChoose: (t: PlacementTarget) => void;
}) {
  const detail = [target.area, target.reasons?.length ? matched(target.reasons) : ""].filter(Boolean).join(" · ");
  return h("label", { class: `cp-target${checked ? " is-checked" : ""}`, "data-target": target.target },
    h("input", { type: "radio", name, value: target.target, checked, onChange: () => onChoose(target) }),
    h("span", { class: "cp-target-body" },
      h("span", { class: "cp-target-head" },
        h("span", { class: "cp-target-title" }, target.title),
        target.strength ? h(StrengthChip, { strength: target.strength }) : h("span", { class: "cp-target-kind" }, target.type),
      ),
      detail ? h("span", { class: "cp-target-detail" }, detail) : null,
    ),
  );
}

/**
 * Touches or Amends. The compact form shows two plain options; a wide card
 * names each one's effect on `target`, and asks the question while neither
 * is chosen.
 */
function RelationChoice({ name, relation, onChange, target }: {
  name: string;
  relation: PlacementRelation | null;
  onChange: (r: PlacementRelation) => void;
  /** The card's target; absent in the compact form. */
  target?: PlacementTarget;
}) {
  const legend = target && relation === null ? relationQuestion(target.title) : "Relation";
  return h("fieldset", { class: "cp-relation", "data-relation": relation ?? "unset" },
    h("legend", { class: target && relation === null ? "cp-relation-question" : "task-section-label" }, legend),
    (["touches", "amends"] as const).map((r) =>
      h("label", { key: r, class: "cp-relation-option" },
        h("input", { type: "radio", name, value: r, checked: relation === r, onChange: () => onChange(r) }),
        h("span", { class: "cp-relation-body" },
          h("span", null, r === "touches" ? "Touches" : "Amends"),
          target
            ? h("span", { class: "cp-relation-effect" }, r === "touches" ? touchesEffect(target.title) : amendsEffect(target.title))
            : null,
        ),
      ),
    ),
  );
}

/**
 * One candidate as a card in the wide panel: its title and strength, area,
 * matched words, statement and what Touches and Amends would do. The checked
 * card holds the relation choice in place of the two effect lines.
 */
export function CandidateCard({ name, target, checked, onChoose, relationChoice, touchesOnly, model = false }: {
  name: string;
  target: PlacementTarget;
  checked: boolean;
  onChoose: (t: PlacementTarget) => void;
  /** The relation choice, and with Amends the editor and its dry run, shown in the checked card. */
  relationChoice: ComponentChildren;
  /** Only Touches applies, so the card names no Amends effect. */
  touchesOnly: boolean;
  /** The model's one-shot pick: the card says so, and it is never checked until a person checks it. */
  model?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A block chosen on the map brings its card into view.
  useEffect(() => { if (checked) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [checked]);
  const area = target.area || (target.type === "constraint" ? "Constraint" : "");
  return h("div", { ref, class: `cp-card${checked ? " is-checked" : ""}${model ? " is-model" : ""}`, "data-target": target.target },
    h("label", { class: "cp-card-head" },
      h("input", { type: "radio", name, value: target.target, checked, onChange: () => onChoose(target) }),
      h("span", { class: "cp-target-title" }, target.title),
      target.strength ? h(StrengthChip, { strength: target.strength }) : h("span", { class: "cp-target-kind" }, target.type),
      model ? h("span", { class: "cp-model-mark", title: "Picked by the model" }, "model") : null,
    ),
    area ? h("div", { class: "cp-card-area" }, area) : null,
    target.reasons?.length ? h("div", { class: "cp-card-words" }, matched(target.reasons)) : null,
    target.statement ? h("p", { class: "cp-card-statement" }, target.statement) : null,
    checked && relationChoice
      ? relationChoice
      : h("dl", { class: "cp-card-effects" },
          h("dt", null, "Touches"), h("dd", null, touchesEffect(target.title)),
          touchesOnly ? null : [h("dt", { key: "a" }, "Amends"), h("dd", { key: "b" }, amendsEffect(target.title))],
        ),
  );
}

/** Search over every capability and constraint, grouped by area. */
export function TargetSearch({ map, mapError, onChoose }: {
  map: ProductMap | null;
  /** Why the product map could not be read; shown in place of the search. */
  mapError?: string;
  onChoose: (t: PlacementTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hit = (title: string, statement?: string) =>
    title.toLowerCase().includes(q) || (statement ?? "").toLowerCase().includes(q);
  const groups = !map || !q ? [] : [
    ...map.areas.map((area) => ({
      title: area.title,
      targets: area.capabilities.filter((c) => hit(c.title, c.statement)).map((c): PlacementTarget => ({
        target: c.id, type: "capability", title: c.title, area: area.title, ...(c.statement ? { statement: c.statement } : {}),
      })),
    })),
    {
      title: "Constraints",
      targets: map.constraints.filter((c) => hit(c.title, c.statement)).map((c): PlacementTarget => ({
        target: c.id, type: "constraint", title: c.title, area: "", ...(c.statement ? { statement: c.statement } : {}), criteria: [],
      })),
    },
  ].filter((g) => g.targets.length);

  if (mapError !== undefined) return h("div", { class: "cp-search" }, h(Pending, { load: { state: "error", message: mapError } }));

  return h("div", { class: "cp-search" },
    h("input", {
      type: "search",
      class: "cp-search-input",
      value: query,
      placeholder: map ? "Search capabilities and constraints" : "Loading the product map…",
      "aria-label": "Search capabilities and constraints",
      disabled: !map,
      onInput: (e: Event) => setQuery((e.target as HTMLInputElement).value),
    }),
    q && !groups.length ? h("div", { class: "cp-search-empty", role: "status" }, "No capability or constraint matches.") : null,
    groups.map((group) =>
      h("div", { key: group.title, class: "cp-search-group" },
        h("div", { class: "cp-search-area" }, group.title),
        h("ul", { class: "cp-search-results" },
          group.targets.map((t) =>
            h("li", { key: t.target },
              h("button", {
                type: "button",
                class: "cp-search-result",
                onClick: () => { onChoose(t); setQuery(""); },
              }, t.title),
            ),
          ),
        ),
      ),
    ),
  );
}

// ── Place form ───────────────────────────────────────────────────────

type PlaceMode = "place" | "next" | "another";

interface PlaceFormProps {
  changeId: string;
  changeTitle: string;
  read: ShortlistRead | undefined;
  map: ProductMap | null;
  mapError?: string;
  /** An applied change: touches only, and no proposing a new home. */
  touchesOnly: boolean;
  /** Placing an extra touches after a first place (IB3). */
  another: boolean;
  hasNext: boolean;
  onPlaced: (result: PlaceChangeResult, target: PlacementTarget, mode: PlaceMode) => void;
  onNothingFits: () => void;
  onDone: () => void;
  /** `rex.placementDraft` is on: offer "Draft with the model". */
  draftEnabled: boolean;
  /** The model drafted a new node: open the proposal form filled with it. */
  onDraftProposal: (draft: PlacementDraft) => void;
  /** Placement mode's wide panel: candidates as cards (WF3). */
  wide?: boolean;
  /** A target chosen outside the form (a block or chip on the map); the form follows it. */
  selection?: PlacementTarget | null;
  /** Reports each target the form chooses, so the map can light it. */
  onChoose?: (t: PlacementTarget) => void;
  /** Reports how an Amends edit moves the target's criteria count; null when nothing is amended. */
  onPendingCriteria?: (pending: PendingCriteria | null) => void;
  /** Homes placed so far in an add-another session, listed above the cards with Remove. */
  homes?: readonly PlacedHome[];
  onRemoveHome?: (home: PlacedHome) => void;
}

/** One home the change was placed on in this visit. */
export interface PlacedHome {
  target: string;
  title: string;
  relation: PlacementRelation;
}

/** The capability the proposal form would add, as the spec map draws it: a dashed ghost block in `under`'s area. */
export interface ProposalGhost {
  /** What the form's title says; the change's own title while it is empty. */
  title: string;
  /** The area id chosen in the form; empty until one is chosen. */
  under: string;
}

/** An amendment's effect on its target's criteria count, for the selected block. */
export interface PendingCriteria {
  target: string;
  /** Criteria added less criteria removed. */
  delta: number;
}

/** The relation the form opens on: rex's, except that the wide panel takes it only from a strong, untied pick (WF4). */
function initialRelation(placement: ChangePlacement | null, wide: boolean): PlacementRelation | null {
  if (!wide) return placement?.relation ?? "touches";
  return placement && strongUntiedPick(placement) ? placement.relation : null;
}

function PlaceForm({ changeId, changeTitle, read, map, mapError, another, touchesOnly, hasNext, onPlaced, onNothingFits, onDone, draftEnabled, onDraftProposal, wide = false, selection, onChoose, onPendingCriteria, homes = [], onRemoveHome }: PlaceFormProps) {
  const placement = read && "placement" in read ? read.placement : null;
  const shortlist = placement?.shortlist ?? [];
  // A caller's request (Quick Add's "Amends…") outranks the rules' relation.
  const [requested] = useState(() => (another ? null : takePlacementRequest(changeId)));
  // The pick and edits this form was left with (WF10); a caller's request outranks them.
  const [saved] = useState<PlaceStepDraft | null>(() => {
    if (another || requested) return null;
    const draft = loadPlacementDraft(changeId);
    return draft?.step === "place" ? draft : null;
  });
  // The saved amendment edits wait here until the target's criteria seed would otherwise replace them.
  const savedCriteria = useRef(saved?.criteria.length ? saved.criteria : null);
  const justRestored = useRef(false);
  // An extra place starts empty: the map's selection is the place just made.
  const [chosen, setChosen] = useState<PlacementTarget | null>(requested?.target ?? saved?.target ?? (another ? null : selection) ?? null);
  const seenSelection = useRef(selection?.target);
  const [relation, setRelation] = useState<PlacementRelation | null>(requested?.relation ?? (saved ? saved.relation : initialRelation(placement, wide)));
  const [summary, setSummary] = useState(saved?.summary ?? "");
  const [proposed, setProposed] = useState(saved?.proposed ?? "");
  const [drafts, setDrafts] = useState<CriterionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [draftNote, setDraftNote] = useState<DraftNote | null>(null);
  const draft = useDraft(changeId);
  const criteriaRef = useRef<HTMLDivElement>(null);
  // With Sidecar on, its Place lens drafts; the one-shot model draft is the Sidecar-off path in the wide panel.
  const sidecarOn = useContext(PlaceWithSidecarContext) !== null;
  // The model's pick in the wide panel: a card marked "model", never checked for the person.
  const [modelPick, setModelPick] = useState<PlacementTarget | null>(null);
  // Drafting is for open changes: rex refuses an applied one, and an extra place only touches.
  const canDraft = draftEnabled && !touchesOnly && !another && !(wide && sidecarOn);

  const askModel = async () => {
    setDraftNote(null);
    // Each draft stands alone: an earlier pick's "model" card does not outlive it.
    setModelPick(null);
    const answer = await draft.run();
    if (!answer) return;
    if (answer.proposal) { onDraftProposal(answer); return; }
    const row = answer.pick !== undefined
      ? answer.shortlist.find((c) => c.target === answer.pick) ?? shortlist.find((c) => c.target === answer.pick)
      : undefined;
    if (row && wide) setModelPick(row);
    else if (row) setChosen(row);
    setDraftNote({ text: draftNoteText(answer, row?.title), warnings: answer.warnings });
  };

  // The rules' relation arrives with the shortlist; an extra place only touches.
  useEffect(() => { if (placement && !requested && !saved) setRelation(initialRelation(placement, wide)); }, [placement?.relation]);
  // A requested target becomes its shortlist row once read: that row carries type and criteria.
  useEffect(() => {
    const row = requested?.target && shortlist.find((c) => c.target === requested.target!.target);
    if (row && chosen?.target === row.target) setChosen(row);
  }, [shortlist.length]);
  // The map chose: follow it, preferring the shortlist row, which carries strength and criteria.
  // Only a new choice counts; the selection the form mounted with is not one.
  useEffect(() => {
    if (selection?.target === seenSelection.current) return;
    seenSelection.current = selection?.target;
    if (selection && selection.target !== chosen?.target) {
      setChosen(shortlist.find((c) => c.target === selection.target) ?? selection);
    }
  }, [selection?.target]);
  // Every choice, wherever it came from, reaches the map.
  useEffect(() => { if (chosen) onChoose?.(chosen); }, [chosen?.target]);
  const effectiveRelation: PlacementRelation | null = another || touchesOnly ? "touches" : relation;

  // The target's criteria seed the Amends form; a search pick reads them.
  useEffect(() => {
    setRefusal(null);
    if (!chosen) { setDrafts([]); return; }
    // Resuming a draft: its edited criteria stand in for the seed, once.
    if (savedCriteria.current && chosen.target === saved?.target.target) {
      setDrafts(savedCriteria.current);
      savedCriteria.current = null;
      // This commit still holds the empty list: saving it would overwrite the edits being restored.
      justRestored.current = true;
      return;
    }
    savedCriteria.current = null;
    const seed = (list: Array<{ id: string; text: string }>) =>
      setDrafts(list.map((c) => ({ id: c.id, text: c.text, original: c.text })));
    if (chosen.criteria) { seed(chosen.criteria); return; }
    let live = true;
    readCriteria(chosen.target).then((list) => { if (live) seed(list); });
    return () => { live = false; };
  }, [chosen?.target]);

  const name = `cp-target-${changeId}`;
  const searchPick = chosen && !shortlist.some((c) => c.target === chosen.target) ? chosen : null;
  const visible = drafts.filter((d) => !d.removed);

  const editDraft = (i: number, text: string) => {
    const id = visible[i].id;
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, text } : d)));
  };
  const removeDraft = (i: number) => {
    const id = visible[i].id;
    setDrafts((prev) => prev.flatMap((d) => (d.id !== id ? [d] : d.original === undefined ? [] : [{ ...d, removed: true }])));
  };
  const addDraft = (text: string) =>
    setDrafts((prev) => [...prev, { id: nextCriterionId(prev.map((d) => d.id)), text }]);

  // The placement as Place would send it.
  const body: PlaceChangeRequest | null = chosen && effectiveRelation
    ? { target: chosen.target, relation: effectiveRelation }
    : null;
  if (body?.relation === "amends") {
    if (summary.trim()) body.summary = summary.trim();
    if (proposed.trim()) body.proposed = proposed.trim();
    const delta = criteriaDelta(drafts);
    if (delta) body.criteria = delta;
  }
  // The wide card re-checks an amendment on every edit (WF5); the server decides, the viewer recomputes nothing.
  const amending = wide && body?.relation === "amends";
  const dryRun = useDryRun(changeId, amending ? body : null);

  // The selected block shows the criteria count the amendment would leave.
  const pending: PendingCriteria | null = amending && chosen?.type === "capability"
    ? { target: chosen.target, delta: criteriaCountDelta(drafts) }
    : null;
  // Whatever the form holds is kept as a draft, so leaving by any route loses nothing (WF10).
  // A pick is the least that counts; no pick, no draft. An extra place after a write keeps none.
  useEffect(() => {
    if (another) return;
    if (justRestored.current) { justRestored.current = false; return; }
    savePlacementDraft(changeId, chosen
      ? { step: "place", target: chosen, relation, summary, proposed, criteria: drafts }
      : null);
  }, [chosen?.target, relation, summary, proposed, drafts]);
  const pendingKey = pending ? `${pending.target}:${pending.delta}` : "";
  useEffect(() => { onPendingCriteria?.(pending); }, [pendingKey]);
  useEffect(() => () => onPendingCriteria?.(null), []);

  const submit = async (mode: PlaceMode) => {
    if (!body || !chosen) return;
    setBusy(true);
    setRefusal(null);
    const answer = await post<PlaceChangeResult>(changeUrl(changeId, "place"), body);
    setBusy(false);
    if (!answer.ok) {
      setRefusal(answer.refusal);
      // Nothing to modify is about the criteria: take the person there.
      if (answer.refusal.kind === "nothing-to-modify") {
        criteriaRef.current?.querySelector<HTMLElement>("button, input, textarea")?.focus();
      }
      return;
    }
    onPlaced(answer.result, chosen, mode);
  };

  const invalidCriteria = refusal?.kind === "nothing-to-modify";
  const criteriaId = `cp-criteria-${changeId}`;
  // An amendment in the wide card waits for rex to accept its dry run.
  const cannotPlace = !body || busy || (amending && !dryRun?.ok);
  const relationName = `cp-relation-${changeId}`;
  const relationChoice = (target?: PlacementTarget) => another || touchesOnly
    ? null
    : h(RelationChoice, { name: relationName, relation, onChange: setRelation, target });

  const amendsEditor = effectiveRelation === "amends"
    ? h("div", { class: "cp-amends" },
        h("label", { class: "cp-field" },
          h("span", { class: "task-section-label" }, "Amendment summary"),
          h("input", {
            type: "text", class: "cp-input", value: summary, placeholder: changeTitle,
            onInput: (e: Event) => setSummary((e.target as HTMLInputElement).value),
          }),
        ),
        chosen && chosen.type === "capability"
          ? h("div", { ref: criteriaRef },
              h(CriteriaEditor, {
                id: criteriaId,
                label: `Criteria of ${chosen.title}`,
                criteria: visible.map((d) => d.text),
                onEdit: editDraft,
                onRemove: removeDraft,
                onAdd: addDraft,
                placeholder: "New capability criterion...",
                invalid: invalidCriteria,
              }),
            )
          : null,
        h("label", { class: "cp-field" },
          h("span", { class: "task-section-label" }, "Replacement statement (optional)"),
          h("textarea", {
            class: "cp-input", rows: 2, value: proposed, placeholder: chosen?.statement ?? "",
            "aria-invalid": invalidCriteria ? "true" : undefined,
            onInput: (e: Event) => setProposed((e.target as HTMLTextAreaElement).value),
          }),
        ),
      )
    : null;

  // With Amends chosen, the checked card is the editor (WF5).
  const cardChoice = (t: PlacementTarget) => {
    const choice = relationChoice(t);
    const editing = amending && chosen?.target === t.target;
    return h(Fragment, null, choice, editing ? amendsEditor : null, editing ? h(DryRunLine, { check: dryRun ?? null }) : null);
  };
  const targetRow = (t: PlacementTarget, checked: boolean) => wide
    ? h(CandidateCard, { key: t.target, name, target: t, checked, onChoose: setChosen, relationChoice: another || touchesOnly ? null : cardChoice(t), touchesOnly: touchesOnly || another, model: t.target === modelPick?.target })
    : h(TargetRow, { key: t.target, name, target: t, checked, onChoose: setChosen });

  return h("div", { class: `cp-form${wide ? " cp-wide" : ""}` },
    h("fieldset", { class: "cp-shortlist" },
      h("legend", { class: "task-section-label" }, another ? "Add another place" : "Where it goes"),
      !read ? h("div", { class: "cp-shortlist-pending", role: "status" }, "Finding a place…") : null,
      read && "error" in read ? h("div", { class: "cp-shortlist-error", role: "alert" }, `No shortlist: ${read.error}`) : null,
      placement && !shortlist.length ? h("div", { class: "cp-shortlist-empty" }, "No guess. Search, or say nothing fits.") : null,
      placement?.tied
        ? h("div", { class: "cp-shortlist-warning", role: "note", "data-warning": "tied" },
            "Tied: the top matches score the same, so their order means nothing.")
        : null,
      shortlist.length && !placement?.tied && shortlist.every((c) => c.strength === "weak")
        ? h("div", { class: "cp-shortlist-warning", role: "note", "data-warning": "weak" },
            "Weak matches only. Check them, or search.")
        : null,
      homes.length
        ? h("ul", { class: "cp-homes", "aria-label": "Placed so far" },
            homes.map((home) =>
              h("li", { key: home.target, class: "cp-home", "data-target": home.target },
                h("span", { class: "cp-home-text" }, `${home.relation === "amends" ? "Amends" : "Touches"} ${home.title}`),
                // Only a touches can be taken back here; an amendment is edited in the change.
                home.relation === "touches" && onRemoveHome
                  ? h("button", { type: "button", class: "ch-change-link cp-home-remove", "aria-label": `Remove ${home.title}`, onClick: () => onRemoveHome(home) }, "Remove")
                  : null)))
        : null,
      shortlist.map((c) => targetRow(c, chosen?.target === c.target)),
      // The model's pick off the shortlist joins the cards, unchecked; once chosen it shows as the search pick below.
      modelPick && !shortlist.some((c) => c.target === modelPick.target) && chosen?.target !== modelPick.target
        ? targetRow(modelPick, false)
        : null,
      searchPick ? targetRow(searchPick, true) : null,
      canDraft ? h(DraftButton, { busy: draft.busy, onClick: askModel }) : null,
      canDraft && draftNote ? h(DraftNoteView, { note: draftNote }) : null,
      canDraft && draft.refusal ? h(RefusalNote, { refusal: draft.refusal }) : null,
    ),

    h(TargetSearch, { map, mapError, onChoose: setChosen }),

    // The wide panel holds the relation and the amendment in the chosen card.
    wide ? null : relationChoice(),
    wide ? null : amendsEditor,

    refusal ? h(RefusalNote, { refusal }) : null,

    h("div", { class: "cp-actions" },
      h("button", { type: "button", class: "btn btn-sm cp-place", disabled: cannotPlace, onClick: () => submit("place") }, "Place"),
      another
        ? h("button", { type: "button", class: "btn btn-sm cp-done", onClick: onDone }, "Done")
        : [
            hasNext
              ? h("button", { key: "next", type: "button", class: "btn btn-sm cp-place-next", disabled: cannotPlace, onClick: () => submit("next") }, "Place & next")
              : null,
            h("button", { key: "another", type: "button", class: "btn btn-sm cp-place-another", disabled: cannotPlace, onClick: () => submit("another") }, "Place & add another"),
            // An applied change's amendments have already reached the map: nothing new to propose.
            touchesOnly
              ? null
              : h("button", { key: "none", type: "button", class: "ch-change-link cp-nothing-fits", onClick: onNothingFits }, "Nothing fits"),
          ],
    ),
  );
}

// ── Propose form ─────────────────────────────────────────────────────

interface ProposeFormProps {
  changeId: string;
  changeTitle: string;
  map: ProductMap | null;
  mapError?: string;
  hasNext: boolean;
  onProposed: (result: ProposeChangeResult, next: boolean) => void;
  onBack: () => void;
  /** `rex.placementDraft` is on: offer "Draft with the model". */
  draftEnabled: boolean;
  /** A draft the shortlist's "Draft with the model" brought here: the form opens filled with it. */
  drafted?: PlacementDraft | null;
  /** Reports the capability being proposed as the form changes; null for a constraint and once the form closes. */
  onGhost?: (ghost: ProposalGhost | null) => void;
  /** The area the form opens under when no draft names one: placement mode's zoomed area. */
  defaultUnder?: string;
  /** A map pick of an area made while the form is open moves the form's area to it. */
  followPick?: AreaPick | null;
  /** The form as a leaving left it (WF10); it opens on this. */
  saved?: ProposeStepDraft | null;
}

function ProposeForm({ changeId, changeTitle, map, mapError, hasNext, onProposed, onBack, draftEnabled, drafted, onGhost, defaultUnder, followPick, saved }: ProposeFormProps) {
  const initial = drafted?.proposal;
  const [type, setType] = useState<"capability" | "constraint">(saved?.type ?? initial?.type ?? "capability");
  const [under, setUnder] = useState(saved?.under ?? initial?.under ?? defaultUnder ?? "");
  const [title, setTitle] = useState(saved?.title ?? initial?.title ?? "");
  const [statement, setStatement] = useState(saved?.statement ?? initial?.proposed ?? "");
  const [criteria, setCriteria] = useState(saved?.criteria ?? criteriaLines(initial));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [draftNote, setDraftNote] = useState<DraftNote | null>(
    drafted ? { text: draftNoteText(drafted), warnings: drafted.warnings } : null,
  );
  const draft = useDraft(changeId);
  const areas = map?.areas ?? [];

  // A map pick of an area while the form is open takes the form with it, so both name one area (WF6).
  // Only picks made after the form opened count: the map's opening zoom never overrides a resumed draft's area.
  const followed = useRef(followPick?.n);
  useEffect(() => {
    if (!followPick || followPick.n === followed.current) return;
    followed.current = followPick.n;
    setUnder(followPick.under);
  }, [followPick?.n]);
  // The form closing, by Back or by a write, clears the ghost.
  useEffect(() => { onGhost?.(type === "capability" ? { title: title.trim() || changeTitle, under } : null); }, [type, title, under]);
  useEffect(() => () => onGhost?.(null), []);
  // Typed text or a chosen type is an edit worth keeping (WF10); the area alone the map supplied is not.
  useEffect(() => {
    const edited = !!(title.trim() || statement.trim() || criteria.trim()) || type !== "capability" || under !== (defaultUnder ?? "");
    savePlacementDraft(changeId, edited ? { step: "propose", type, under, title, statement, criteria } : null);
  }, [type, under, title, statement, criteria]);

  const askModel = async () => {
    setDraftNote(null);
    const answer = await draft.run();
    if (!answer) return;
    const p = answer.proposal;
    if (p) {
      setType(p.type);
      setUnder(p.under);
      setTitle(p.title);
      setStatement(p.proposed ?? "");
      setCriteria(criteriaLines(p));
    }
    const pickTitle = answer.shortlist.find((c) => c.target === answer.pick)?.title;
    setDraftNote({ text: draftNoteText(answer, pickTitle), warnings: answer.warnings });
  };

  const submit = async (next: boolean) => {
    const lines = criteria.split("\n").map((l) => l.trim()).filter(Boolean);
    const body: ProposeChangeRequest = {
      type, under, title: title.trim(),
      ...(statement.trim() ? { proposed: statement.trim() } : {}),
      ...(type === "capability" && lines.length ? { criteria: { add: lines.map((text, i) => ({ id: `c${i + 1}`, text })) } } : {}),
    };
    setBusy(true);
    setRefusal(null);
    const answer = await post<ProposeChangeResult>(changeUrl(changeId, "propose"), body);
    setBusy(false);
    if (answer.ok) onProposed(answer.result, next);
    else setRefusal(answer.refusal);
  };

  const field = (label: string, control: ComponentChildren) =>
    h("label", { class: "cp-field" }, h("span", { class: "task-section-label" }, label), control);

  return h("div", { class: "cp-form cp-propose" },
    h("div", { class: "task-section-label" }, "Propose a new home"),
    draftEnabled ? h(DraftButton, { busy: draft.busy, onClick: askModel }) : null,
    draftEnabled && draftNote ? h(DraftNoteView, { note: draftNote }) : null,
    draftEnabled && draft.refusal ? h(RefusalNote, { refusal: draft.refusal }) : null,
    field("Type", h("select", {
      class: "cp-input", value: type,
      onChange: (e: Event) => setType((e.target as HTMLSelectElement).value as "capability" | "constraint"),
    }, h("option", { value: "capability" }, "Capability"), h("option", { value: "constraint" }, "Constraint"))),
    field("Under area", h("select", {
      class: "cp-input", value: under,
      onChange: (e: Event) => setUnder((e.target as HTMLSelectElement).value),
    },
      h("option", { value: "" }, map ? "Choose an area" : mapError !== undefined ? `Could not load: ${mapError}` : "Loading…"),
      areas.map((a) => h("option", { key: a.id, value: a.id }, a.title)),
    )),
    field("Title", h("input", {
      type: "text", class: "cp-input", value: title, placeholder: changeTitle,
      onInput: (e: Event) => setTitle((e.target as HTMLInputElement).value),
    })),
    field("Statement", h("textarea", {
      class: "cp-input", rows: 2, value: statement,
      onInput: (e: Event) => setStatement((e.target as HTMLTextAreaElement).value),
    })),
    type === "capability"
      ? field("Criteria, one per line", h("textarea", {
          class: "cp-input", rows: 3, value: criteria,
          onInput: (e: Event) => setCriteria((e.target as HTMLTextAreaElement).value),
        }))
      : null,
    refusal ? h(RefusalNote, { refusal }) : null,
    h("div", { class: "cp-actions" },
      // An area is the form's to require; everything else is rex's to judge.
      h("button", { type: "button", class: "btn btn-sm cp-propose-btn", disabled: busy || !under, onClick: () => submit(false) }, "Propose"),
      hasNext
        ? h("button", { type: "button", class: "btn btn-sm cp-propose-next", disabled: busy || !under, onClick: () => submit(true) }, "Propose & next")
        : null,
      h("button", { type: "button", class: "ch-change-link cp-back", onClick: onBack }, "Back to the shortlist"),
    ),
  );
}

// ── Section ──────────────────────────────────────────────────────────

export interface ChangePlacementSectionProps {
  changeId: string;
  changeTitle: string;
  /** Open another change in the panel. */
  onOpenChange: (id: string) => void;
  /** After a write: refresh the tree and anything else reading the PRD. */
  onWritten?: () => void;
  /** Reports whether the change is in the Inbox, for the panel's other notes. */
  onInboxState?: (inInbox: boolean) => void;
  /** Opens placement mode on the area view; absent, the section offers no switch. */
  onPlaceOnMap?: (id: string) => void;
  /**
   * "wide" is placement mode's panel beside the spec map: candidates as cards
   * and rex's relation pre-selected only for a strong, untied pick. The
   * compact default is the detail panel's.
   */
  layout?: "compact" | "wide";
  /** A target chosen on the map; the place form follows it. */
  selection?: PlacementTarget | null;
  /** Reports each target the place form chooses. */
  onChoose?: (t: PlacementTarget) => void;
  /** Reports how the wide card's amendment moves its target's criteria count; null when nothing is amended. */
  onPendingCriteria?: (pending: PendingCriteria | null) => void;
  /** Reports the capability the proposal form would add, so the map can draw it as a ghost block. */
  onGhost?: (ghost: ProposalGhost | null) => void;
  /** Reports the ids of the homes this change was placed on in this visit, so the map can mark each. */
  onHomes?: (targets: string[]) => void;
  /** The area id "Nothing fits" proposes under until the form says otherwise: the map's zoomed area. */
  proposeUnder?: string;
  /** The area the map's last pick zoomed into, numbered so a pick of the same area again still counts; an open proposal form follows it. */
  followPick?: AreaPick | null;
}

/** A map pick of an area: its id and a count that grows with every pick. */
export interface AreaPick {
  under: string;
  n: number;
}

/** What the section shows after a write, until the change's next read. */
interface Written {
  line: string;
  warnings?: string[];
}

/**
 * The placement section of a change's detail panel. Key it by change id:
 * its state belongs to one change.
 */
export function ChangePlacementSection({ changeId, changeTitle, onOpenChange, onWritten, onInboxState, onPlaceOnMap, layout = "compact", selection, onChoose, onPendingCriteria, onGhost, onHomes, proposeUnder, followPick }: ChangePlacementSectionProps) {
  const cliName = useCliName();
  const inbox = useInbox();
  // A draft left on the proposal step resumes there (WF10).
  const [savedPropose, setSavedPropose] = useState<ProposeStepDraft | null>(() => {
    const draft = loadPlacementDraft(changeId);
    return draft?.step === "propose" ? draft : null;
  });
  const [proposing, setProposing] = useState(savedPropose !== null);
  const [another, setAnother] = useState(false);
  const [written, setWritten] = useState<Written | null>(null);
  const [drafted, setDrafted] = useState<PlacementDraft | null>(null);
  const [homes, setHomes] = useState<PlacedHome[]>([]);
  const [removeRefusal, setRemoveRefusal] = useState<Refusal | null>(null);
  const draftEnabled = useFeatureToggle(PLACEMENT_DRAFT_FEATURE, false);

  const row = inbox.load.state === "ready" ? inbox.load.data.find((c) => c.id === changeId) : undefined;
  const inInbox = !!row?.awaitsPlacement && !written;
  // An applied change never placed takes a touches only; Place & next walks
  // that list, not the open Inbox.
  const appliedUnplaced = !!row && isAppliedUnplaced(row) && !written;
  const queue = appliedUnplaced ? inbox.applied : inbox.rows;
  const order = useMemo(() => queue.map((r) => r.change.id), [queue]);
  const position = inboxPosition(order, changeId);

  // The shortlist is kept once read: after a first place the change leaves
  // the Inbox, and "add another" still offers it.
  const live = [...inbox.rows, ...inbox.applied].find((r) => r.change.id === changeId)?.shortlist;
  const [read, setRead] = useState<ShortlistRead | undefined>(live);
  useEffect(() => { if (live) setRead(live); }, [live]);

  useEffect(() => { onInboxState?.(!!row?.awaitsPlacement); }, [row?.awaitsPlacement]);
  const homeKey = homes.map((home) => home.target).join(",");
  useEffect(() => { onHomes?.(homes.map((home) => home.target)); }, [homeKey]);
  useEffect(() => () => onHomes?.([]), []);

  const showForm = inInbox || appliedUnplaced || another;
  const touchesOnly = !!row?.appliedAt;

  const openNext = (next: string | null) => {
    if (!next) return;
    requestTitleFocus(next);
    onOpenChange(next);
  };

  const afterWrite = () => {
    inbox.refetch();
    onWritten?.();
  };

  if (!row) return null;

  if (!showForm) {
    // The read names every place once it catches up; until then, the write's answer.
    const line = placedLine(row) ?? written?.line;
    if (!line) return null;
    return h("div", { class: "task-section cp-placed", "data-change-placement": "placed" },
      h("div", { class: "cp-placed-line" }, line),
      h(Warnings, { warnings: written?.warnings }),
    );
  }

  const onPlaced = (result: PlaceChangeResult, target: PlacementTarget, mode: PlaceMode) => {
    const note: Written = { line: `Placed: ${result.relation} ${target.title}`, ...(result.warnings ? { warnings: result.warnings } : {}) };
    dropPlacementDraft(changeId);
    afterWrite();
    // Every home placed while adding more is listed, with Remove, until Done.
    if (mode === "another" || another) {
      setHomes((prev) => [...prev.filter((home) => home.target !== target.target), { target: target.target, title: target.title, relation: result.relation }]);
    }
    if (mode === "next") { setWritten(note); openNext(position.next); return; }
    // The wide panel's session stays open on every extra home until Done; the compact one closes on Place.
    if (mode === "another" || (another && layout === "wide")) { setAnother(true); setWritten(note); return; }
    setAnother(false);
    setWritten(note);
  };

  const removeHome = async (home: PlacedHome) => {
    const answer = await post<{ change: string; target: string }>(`/api/rex/changes/${encodeURIComponent(changeId)}/unplace`, { target: home.target });
    if (!answer.ok) { setRemoveRefusal(answer.refusal); return; }
    setRemoveRefusal(null);
    setHomes((prev) => prev.filter((kept) => kept.target !== home.target));
    afterWrite();
  };

  const onProposed = (result: ProposeChangeResult, next: boolean) => {
    setWritten({
      line: `Placed: proposes ${result.proposed.type} ${result.proposed.title}`,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    });
    setProposing(false);
    dropPlacementDraft(changeId);
    afterWrite();
    if (next) openNext(position.next);
  };

  return h("section", { class: "task-section cp-section", "aria-label": "Placement", "data-layout": layout, "data-change-placement": another ? "another" : appliedUnplaced ? "applied" : "inbox" },
    // Only a change still in the Inbox is the Place lens's to draft.
    inInbox && !another ? h(PlaceWithSidecarButton, { changeId }) : null,
    another
      ? h("div", { class: "cp-placed" },
          written ? h("div", { class: "cp-placed-line" }, written.line) : null,
          h(Warnings, { warnings: written?.warnings }),
        )
      : h("div", { class: "cp-note", role: "note" },
          h("span", null, appliedUnplaced
            ? "Links this finished change to what it built; its tasks are done."
            : `In the Inbox. ${cliName} work skips its tasks until it has a place on the product map.`),
          position.index >= 0
            ? h("span", { class: "cp-position" },
                `${position.index + 1} of ${position.total}`,
                position.next
                  ? [" · ", h("button", {
                      key: "next", type: "button", class: "ch-change-link cp-next",
                      "aria-label": "Next Inbox change", onClick: () => openNext(position.next),
                    }, "Next ›")]
                  : null,
              )
            : null,
          onPlaceOnMap
            ? h("button", {
                type: "button", class: "ch-change-link cp-place-on-map", onClick: () => onPlaceOnMap(changeId),
              }, "Place on the map ↗")
            : null,
        ),
    removeRefusal ? h(RefusalNote, { refusal: removeRefusal }) : null,
    h(PlacementForms, {
      proposing: proposing && !another,
      place: {
        changeId, changeTitle, read, another, touchesOnly, hasNext: position.next !== null,
        onPlaced,
        onNothingFits: () => { setDrafted(null); setSavedPropose(null); setProposing(true); },
        // Done with no home left (all removed) puts the change back in the Inbox.
        onDone: () => { setAnother(false); if (!homes.length) setWritten(null); },
        homes: another ? homes : [], onRemoveHome: removeHome,
        draftEnabled,
        onDraftProposal: (draft) => { setDrafted(draft); setSavedPropose(null); setProposing(true); },
        wide: layout === "wide", selection, onChoose, onPendingCriteria,
      },
      propose: {
        changeId, changeTitle, hasNext: position.next !== null,
        onProposed, onBack: () => { setSavedPropose(null); setProposing(false); },
        draftEnabled, drafted, onGhost, defaultUnder: proposeUnder, followPick, saved: savedPropose,
      },
    }),
  );
}

/** The place or propose form, with the product map both search and propose read. */
function PlacementForms({ proposing, place, propose }: {
  proposing: boolean;
  place: Omit<PlaceFormProps, "map">;
  propose: Omit<ProposeFormProps, "map">;
}) {
  const product = useProductRead<ProductMap>("/api/rex/product", (body) => body.map as ProductMap);
  const map = product.state === "ready" ? product.data : null;
  const mapError = product.state === "error" ? product.message : undefined;
  return proposing
    ? h(ProposeForm, { ...propose, map, mapError })
    : h(PlaceForm, { key: place.another ? "another" : "first", ...place, map, mapError });
}
