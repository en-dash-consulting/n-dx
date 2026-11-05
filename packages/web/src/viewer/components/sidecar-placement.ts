/**
 * The Sidecar placement card's body (story 29): where the Place lens wants a
 * change to go, for the operator to review and edit before anything is written.
 *
 * The shortlist is rex's, read from `GET /api/rex/changes/:id/placement`, drawn
 * as radio rows with score, strength and reasons, plus a row to propose a new
 * capability or constraint. A touches/amends toggle follows, and for amends an
 * editor for the statement and the criteria add, replace and remove. The card
 * shows rex's dry-run line. An edit re-checks through
 * `POST /api/rex/changes/:id/placement/check`; until the line for the edited
 * placement is back, {@link placementDecidable} says Place may not be pressed.
 * The approval sends the edited placement as the decision's `edits`.
 *
 * Pure helpers first (draft ⇄ request ⇄ body, the title and dry-run lines),
 * then {@link PlacementBody}.
 */

import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type {
  PlacementCriterion,
  PlacementEditBody,
  SidecarCard,
  SidecarPlacement,
  SidecarPlacementCheck,
  SidecarPlacementRequest,
} from "../hooks/sidecar.js";
import { useProductRead } from "../hooks/sidecar.js";
import type { ChangePlacement, PlacementCandidate, ProductMap } from "../views/product-model.js";
import { StrengthChip } from "./strength-chip.js";

export const PROPOSE_ROW = "__propose__";

// ── Pure helpers ─────────────────────────────────────────────────────

/** The operator's working copy of a placement. `null` fields are untouched: they show rex's text. */
export interface PlacementDraft {
  mode: "place" | "propose";
  target: string;
  relation: "touches" | "amends";
  /** An amends placement's statement; null keeps the candidate's own. */
  statement: string | null;
  /** Existing criteria the operator reworded, by id. */
  replace: Record<string, string>;
  remove: string[];
  add: PlacementCriterion[];
  type: "capability" | "constraint";
  under: string;
  title: string;
}

/**
 * The draft a request opens as. With rex's accepted dry run, the target and
 * relation are the ones rex resolved (a display id becomes the node's id, a
 * relation the agent left out becomes the one rex's rules chose), so the
 * radio rows and toggle show what approval would write.
 */
export function draftFromRequest(request: SidecarPlacementRequest, check?: SidecarPlacementCheck): PlacementDraft {
  const blank = { target: "", relation: "touches" as const, statement: null, replace: {}, remove: [], add: [], type: "capability" as const, under: "", title: "" };
  if (request.action === "propose") {
    return { ...blank, mode: "propose", type: request.type, under: request.under, title: request.title };
  }
  const resolved = check?.ok && check.action === "place" ? check : undefined;
  return {
    ...blank,
    mode: "place",
    target: resolved?.target ?? request.target,
    relation: request.relation ?? resolved?.relation ?? "touches",
    statement: request.proposed ?? null,
    replace: Object.fromEntries((request.criteria?.replace ?? []).map((c) => [c.id, c.text])),
    remove: request.criteria?.remove ?? [],
    add: request.criteria?.add ?? [],
  };
}

/**
 * The request a draft stands for. Fields the card does not edit (the summary,
 * a proposed node's statement and criteria) carry over from `original`.
 */
export function requestFromDraft(draft: PlacementDraft, original: SidecarPlacementRequest): SidecarPlacementRequest {
  const summary = original.summary !== undefined ? { summary: original.summary } : {};
  if (draft.mode === "propose") {
    const kept = original.action === "propose" ? original : null;
    return {
      action: "propose",
      type: draft.type,
      under: draft.under,
      title: draft.title.trim(),
      ...summary,
      ...(kept?.proposed !== undefined ? { proposed: kept.proposed } : {}),
      ...(draft.type === "capability" && kept?.criteria ? { criteria: kept.criteria } : {}),
    };
  }
  const amends = draft.relation === "amends";
  const replace = Object.entries(draft.replace).filter(([id]) => !draft.remove.includes(id)).map(([id, text]) => ({ id, text }));
  const add = draft.add.filter((c) => c.id.trim() && c.text.trim());
  const criteria = amends && (add.length || replace.length || draft.remove.length)
    ? {
        ...(add.length ? { add } : {}),
        ...(replace.length ? { replace } : {}),
        ...(draft.remove.length ? { remove: draft.remove } : {}),
      }
    : undefined;
  return {
    action: "place",
    target: draft.target,
    relation: draft.relation,
    ...summary,
    ...(amends && draft.statement?.trim() ? { proposed: draft.statement.trim() } : {}),
    ...(criteria ? { criteria } : {}),
  };
}

/** A request as the body `POST …/placement/check` and an approval's edits take. */
export function placementBody(request: SidecarPlacementRequest): PlacementEditBody {
  const { action, ...fields } = request;
  return action === "propose" ? { propose: fields } : fields;
}

/** The card's title line: `<change> → <target>` or `<change> → new <type> under <area>`. */
export function placementTitle(placement: SidecarPlacement): string {
  const { request } = placement;
  return request.action === "propose"
    ? `${placement.change} → new ${request.type} under ${request.under}`
    : `${placement.change} → ${request.target}`;
}

/** The dry-run line: what rex would record, or why it refuses. */
export function dryRunLine(check: SidecarPlacementCheck): string {
  if (!check.ok) return `Rex refuses this placement (${check.kind}): ${check.error}`;
  const warnings = check.warnings.length ? ` ${check.warnings.join(" ")}` : "";
  if (check.action === "propose") return `Applies cleanly: proposes ${check.type} "${check.title}" under ${check.under}.${warnings}`;
  const spec = check.base ? ` @ spec ${check.base.slice(0, 4)}` : "";
  return `Applies cleanly: ${check.relation} ${check.title} (${check.target}${spec}).${warnings}`;
}

/** An edit of the card's placement and where its re-check stands; `check` is null until the line is back. */
export interface PlacementEdit {
  /** The card it was made on; an edit is never sent with another card's approval. */
  cardId: string;
  request: SidecarPlacementRequest;
  body: PlacementEditBody;
  check: SidecarPlacementCheck | null;
}

/**
 * An edit that keeps the card's target and relation still answers the card's
 * own spec hash: when the target's spec moved since the card was raised, no
 * re-check can make approval succeed, and the card must be raised again.
 */
export function cardSpecMoved(card: SidecarCard, edit: PlacementEdit | null): boolean {
  const own = card.placement?.check;
  const now = edit?.cardId === card.id ? edit.check : null;
  if (!own?.ok || !now?.ok || own.action !== "place" || now.action !== "place") return false;
  return own.target === now.target && own.relation === now.relation && own.base !== now.base;
}

/** Place is pressable only when the placement shown has a dry run that rex accepts and approval would not refuse. */
export function placementDecidable(card: SidecarCard, edit: PlacementEdit | null): boolean {
  const check = edit?.cardId === card.id ? edit.check : card.placement?.check;
  return !!check?.ok && !cardSpecMoved(card, edit);
}

/** The nearest unused `cN` id for a new criterion. */
export function nextCriterionId(used: readonly string[]): string {
  const numbers = used.map((id) => /^c(\d+)$/.exec(id)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
  return `c${Math.max(0, ...numbers) + 1}`;
}

// ── Reads ────────────────────────────────────────────────────────────

type Shortlist = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; read: ChangePlacement };

async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: the status says enough.
  }
  return `${res.status} ${res.statusText}`.trim();
}

function useShortlist(change: string, enabled: boolean): Shortlist {
  const [state, setState] = useState<Shortlist>({ state: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/rex/changes/${encodeURIComponent(change)}/placement`);
        if (!live) return;
        setState(res.ok ? { state: "ready", read: (await res.json()) as ChangePlacement } : { state: "error", message: await errorOf(res) });
      } catch (err) {
        if (live) setState({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { live = false; };
  }, [change, enabled]);
  return state;
}

/** Rex's dry run of a placement; a refusal and a failed request both come back as a refusal. */
export async function checkPlacementRequest(change: string, body: PlacementEditBody): Promise<SidecarPlacementCheck> {
  try {
    const res = await fetch(`/api/rex/changes/${encodeURIComponent(change)}/placement/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, kind: "invalid", error: await errorOf(res) };
    return ((await res.json()) as { check: SidecarPlacementCheck }).check;
  } catch (err) {
    return { ok: false, kind: "unreachable", error: err instanceof Error ? err.message : String(err) };
  }
}

const CHECK_DEBOUNCE_MS = 250;

// ── Body ─────────────────────────────────────────────────────────────

export interface PlacementBodyProps {
  card: SidecarCard;
  /** The card is the first waiting one: the shortlist and editor are live. */
  editable: boolean;
  /** Reports the operator's edit and its re-check; null when the placement is the card's own again. */
  onEdit: (edit: PlacementEdit | null) => void;
  /** The edit as the parent holds it, so a re-check the parent makes (after a refused approval) shows here too. */
  edit: PlacementEdit | null;
}

export function PlacementBody({ card, editable, onEdit, edit }: PlacementBodyProps) {
  const placement = card.placement!;
  const original = placement.request;
  // Unedited is the draft the card opened as, not the agent's raw call: a
  // relation rex filled in or a display id rex resolved is no operator edit.
  const [opened] = useState<PlacementDraft>(() => draftFromRequest(original, placement.check));
  const originalKey = JSON.stringify(placementBody(requestFromDraft(opened, original)));
  const [draft, setDraft] = useState<PlacementDraft>(opened);
  const shortlist = useShortlist(placement.change, editable);
  const product = useProductRead<ProductMap>("/api/rex/product", (body) => body.map as ProductMap);
  const areas = product.state === "ready" ? product.data.areas : [];
  const latest = useRef(0);
  useEffect(() => () => { latest.current += 1; }, []);

  const request = requestFromDraft(draft, original);
  const body = placementBody(request);
  const key = JSON.stringify(body);

  // Re-check on every edit; a response for a placement edited since, or for a
  // card decided or gone since, is dropped, so it can never land on the next card.
  useEffect(() => {
    const mine = ++latest.current;
    if (!editable) return;
    if (key === originalKey) {
      onEdit(null);
      return;
    }
    const pending: PlacementEdit = { cardId: card.id, request, body, check: null };
    onEdit(pending);
    const timer = setTimeout(() => {
      void checkPlacementRequest(placement.change, body).then((check) => {
        if (latest.current !== mine) return;
        onEdit({ ...pending, check });
      });
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, editable]);

  const candidates: PlacementCandidate[] = shortlist.state === "ready" ? shortlist.read.shortlist : [];
  const known = candidates.find((c) => c.target === draft.target);
  const rows: PlacementCandidate[] = !known && draft.mode === "place" && draft.target
    ? [{ target: draft.target, type: "capability", title: placement.check.ok && placement.check.action === "place" ? placement.check.title : draft.target, area: "", criteria: [], score: 0, strength: "weak", reasons: [] }, ...candidates]
    : candidates;
  const chosen = rows.find((c) => c.target === draft.target);
  const set = (patch: Partial<PlacementDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const group = `place-${card.id}`;

  const shown = edit ? edit.check : placement.check;
  const line = !editable
    ? dryRunLine(placement.check)
    : shown ? dryRunLine(shown) : "Checking the edited placement…";

  const usedIds = [...(chosen?.criteria ?? []).map((c) => c.id), ...draft.add.map((c) => c.id)];

  return h("div", { class: "sidecar-place", "data-placement": draft.mode },
    placement.reasons.length
      ? h("ul", { class: "sidecar-place-reasons", "aria-label": "Why" }, placement.reasons.map((r, i) => h("li", { key: i }, r)))
      : null,
    editable
      ? h("fieldset", { class: "sidecar-place-shortlist" },
          h("legend", null, "Where it goes"),
          shortlist.state === "error" ? h("p", { class: "sidecar-place-note", role: "alert" }, `Could not read the shortlist: ${shortlist.message}`) : null,
          shortlist.state === "loading" ? h("p", { class: "sidecar-place-note" }, "Reading the shortlist…") : null,
          rows.map((c) => h("label", { key: c.target, class: `sidecar-place-row${draft.mode === "place" && draft.target === c.target ? " is-chosen" : ""}`, "data-target": c.target },
            h("input", {
              type: "radio", name: group, value: c.target,
              checked: draft.mode === "place" && draft.target === c.target,
              onChange: () => set({ mode: "place", target: c.target, statement: null, replace: {}, remove: [], add: [] }),
            }),
            h("span", { class: "sidecar-place-row-title" }, c.title),
            h("span", { class: "sidecar-place-row-meta" },
              c.area ? `${c.area} · ` : "", c.type, c.score ? ` · score ${c.score}` : "", " ",
              c.score ? h(StrengthChip, { strength: c.strength }) : null),
            c.reasons.length ? h("span", { class: "sidecar-place-row-reasons" }, c.reasons.join("; ")) : null,
          )),
          h("label", { class: `sidecar-place-row sidecar-place-propose${draft.mode === "propose" ? " is-chosen" : ""}` },
            h("input", {
              type: "radio", name: group, value: PROPOSE_ROW, checked: draft.mode === "propose",
              onChange: () => set({ mode: "propose" }),
            }),
            h("span", { class: "sidecar-place-row-title" }, "Propose a new capability or constraint"),
          ),
        )
      : null,
    editable && draft.mode === "propose"
      ? h("div", { class: "sidecar-place-form" },
          h("label", null, "Type ",
            h("select", { class: "sidecar-place-type", value: draft.type, onChange: (e: Event) => set({ type: (e.target as HTMLSelectElement).value as "capability" | "constraint" }) },
              h("option", { value: "capability" }, "Capability"), h("option", { value: "constraint" }, "Constraint"))),
          h("label", null, "Under area ",
            h("select", { class: "sidecar-place-area", value: draft.under, onChange: (e: Event) => set({ under: (e.target as HTMLSelectElement).value }) },
              h("option", { value: "" }, "Choose an area"),
              draft.under && !areas.some((a) => a.id === draft.under) ? h("option", { value: draft.under }, draft.under) : null,
              areas.map((a) => h("option", { key: a.id, value: a.id }, a.title)))),
          h("label", null, "Title ",
            h("input", { type: "text", class: "sidecar-place-title", value: draft.title, onInput: (e: Event) => set({ title: (e.target as HTMLInputElement).value }) })),
        )
      : null,
    editable && draft.mode === "place" && draft.target
      ? h("div", { class: "sidecar-place-relation", role: "radiogroup", "aria-label": "Relation" },
          (["touches", "amends"] as const).map((relation) => h("label", { key: relation },
            h("input", { type: "radio", name: `${group}-relation`, value: relation, checked: draft.relation === relation, onChange: () => set({ relation }) }),
            ` ${relation}`)))
      : null,
    editable && draft.mode === "place" && draft.relation === "amends" && draft.target
      ? h("div", { class: "sidecar-place-amend" },
          h("label", null, "Statement",
            h("textarea", {
              class: "sidecar-place-statement", rows: 3,
              value: draft.statement ?? chosen?.statement ?? "",
              onInput: (e: Event) => set({ statement: (e.target as HTMLTextAreaElement).value }),
            })),
          h("ul", { class: "sidecar-place-criteria", "aria-label": "Criteria" },
            (chosen?.criteria ?? []).map((c) => {
              const removed = draft.remove.includes(c.id);
              return h("li", { key: c.id, class: "sidecar-place-criterion", "data-criterion": c.id },
                h("span", { class: "sidecar-place-criterion-id" }, c.id),
                h("input", {
                  type: "text", class: "sidecar-place-criterion-text", value: draft.replace[c.id] ?? c.text, disabled: removed,
                  onInput: (e: Event) => {
                    const text = (e.target as HTMLInputElement).value;
                    const replace = { ...draft.replace };
                    if (text === c.text) delete replace[c.id]; else replace[c.id] = text;
                    set({ replace });
                  },
                }),
                h("label", null,
                  h("input", {
                    type: "checkbox", class: "sidecar-place-criterion-remove", checked: removed,
                    onChange: () => set({ remove: removed ? draft.remove.filter((id) => id !== c.id) : [...draft.remove, c.id] }),
                  }), " Remove"),
              );
            }),
            draft.add.map((c, i) => h("li", { key: `add-${i}`, class: "sidecar-place-criterion sidecar-place-added" },
              h("input", {
                type: "text", class: "sidecar-place-added-id", value: c.id, "aria-label": "New criterion id",
                onInput: (e: Event) => set({ add: draft.add.map((a, j) => (j === i ? { ...a, id: (e.target as HTMLInputElement).value } : a)) }),
              }),
              h("input", {
                type: "text", class: "sidecar-place-added-text", value: c.text, "aria-label": "New criterion text",
                onInput: (e: Event) => set({ add: draft.add.map((a, j) => (j === i ? { ...a, text: (e.target as HTMLInputElement).value } : a)) }),
              }),
              h("button", { type: "button", class: "sidecar-place-added-remove", onClick: () => set({ add: draft.add.filter((_, j) => j !== i) }) }, "Drop"),
            )),
          ),
          h("button", {
            type: "button", class: "sidecar-place-add",
            onClick: () => set({ add: [...draft.add, { id: nextCriterionId(usedIds), text: "" }] }),
          }, "Add a criterion"),
        )
      : null,
    h("p", { class: `sidecar-place-check${shown && !shown.ok ? " is-refused" : ""}`, role: "status", "aria-live": "polite" }, line),
    editable && cardSpecMoved(card, edit)
      ? h("p", { class: "sidecar-place-check is-refused", role: "alert" }, "The spec of this target changed since the card was raised. Leave it in the Inbox and have the agent raise a new card.")
      : null,
  );
}
