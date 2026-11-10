/**
 * Apply all: one step for every change that is done and waiting for its
 * amendments to be applied to the product layer.
 *
 * "Apply all…" asks `POST /api/rex/changes/apply-all/preview`, which writes
 * nothing and lists each waiting change: what it would add, edit or retire, or
 * why rex will not apply it. "Apply N" sends back the preview's hash for each
 * change that can apply, and rex applies each against its own hash, so a
 * change edited since the preview is skipped and says so; the rest still
 * apply. Changes rex refused in the preview are never sent.
 *
 * The bar also points at Settings → Workflow, where `rex.applyOn` makes
 * completed changes apply on their own.
 *
 * @module viewer/views/apply-all
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import type { AppliedAmendment } from "./product-model.js";
import { displayTitle } from "../components/index.js";

interface WaitingRef { id: string; displayId?: string; title: string; summary?: string }

/** One waiting change in the preview. Mirrors `ApplyAllPreviewWire` in server/routes-rex/apply.ts. */
export type ApplyAllPreview = WaitingRef & (
  | { ok: true; applied: AppliedAmendment[]; hash: string }
  | { ok: false; error: string; problems: readonly string[] }
);

/** One change's outcome. Mirrors `ApplyAllResultWire`. */
export type ApplyAllResult = WaitingRef & (
  | { ok: true; applied: AppliedAmendment[] }
  | { ok: false; error: string; moved?: true }
);

type State =
  | { step: "idle" }
  | { step: "busy"; what: string }
  | { step: "preview"; changes: ApplyAllPreview[] }
  | { step: "done"; results: ApplyAllResult[] }
  | { step: "error"; message: string };

async function post<T>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/rex/changes/${path}`, {
      method: "POST",
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, data: json as T };
    return { ok: false, message: typeof json?.error === "string" ? json.error : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "adds 2, edits 1" for a change's amendments; "no product changes" for none. */
export function effectText(applied: readonly AppliedAmendment[]): string {
  if (applied.length === 0) return "no product changes";
  const count = (d: AppliedAmendment["delta"]) => applied.filter((a) => a.delta === d).length;
  return [["adds", count("added")], ["edits", count("modified")], ["retires", count("removed")]]
    .filter(([, n]) => (n as number) > 0)
    .map(([verb, n]) => `${verb} ${n}`)
    .join(", ");
}

/**
 * The bar above a list of changes: how many are waiting to apply, Apply all…,
 * and the way to the setting that applies them automatically. Renders nothing
 * when no change is waiting.
 */
export function ApplyAllBar({ waiting, navigateTo, onApplied }: {
  /** Changes in the waiting-to-apply stage, as the caller counted them. */
  waiting: number;
  navigateTo?: NavigateTo;
  /** Called after an apply wrote something, so the caller can reload. */
  onApplied?: () => void;
}) {
  const [state, setState] = useState<State>({ step: "idle" });
  if (waiting === 0 && state.step === "idle") return null;

  const preview = async () => {
    setState({ step: "busy", what: "Checking what would apply…" });
    const answer = await post<{ changes: ApplyAllPreview[] }>("apply-all/preview");
    setState(answer.ok ? { step: "preview", changes: answer.data.changes ?? [] } : { step: "error", message: answer.message });
  };

  const apply = async (changes: ApplyAllPreview[]) => {
    const hashes = Object.fromEntries(changes.filter((c): c is ApplyAllPreview & { ok: true } => c.ok).map((c) => [c.id, c.hash]));
    setState({ step: "busy", what: "Applying…" });
    const answer = await post<{ results: ApplyAllResult[] }>("apply-all", { hashes });
    if (!answer.ok) {
      setState({ step: "error", message: answer.message });
      return;
    }
    setState({ step: "done", results: answer.data.results ?? [] });
    if ((answer.data.results ?? []).some((r) => r.ok)) onApplied?.();
  };

  const settingsLink = navigateTo
    ? h("button", { type: "button", class: "aa-link", onClick: () => navigateTo("workflow") }, "Apply automatically…")
    : null;
  const close = h("button", { type: "button", class: "aa-link", onClick: () => setState({ step: "idle" }) }, "Close");

  let body;
  switch (state.step) {
    case "idle":
      body = h("div", { class: "aa-row" },
        h("span", { class: "aa-text" }, `${plural(waiting, "change is", "changes are")} done and waiting to be applied to the product.`),
        h("button", { type: "button", class: "btn btn-sm aa-open", onClick: () => void preview() }, "Apply all…"),
        settingsLink,
      );
      break;
    case "busy":
      body = h("div", { class: "aa-row", role: "status" }, h("span", { class: "aa-text" }, state.what));
      break;
    case "error":
      body = h("div", { class: "aa-row", role: "alert" }, h("span", { class: "aa-text aa-error" }, state.message), close);
      break;
    case "preview": {
      const ready = state.changes.filter((c) => c.ok);
      const refused = state.changes.filter((c) => !c.ok);
      body = h("div", { class: "aa-preview" },
        h("p", { class: "aa-text" },
          ready.length > 0
            ? `${plural(ready.length, "change", "changes")} will apply${refused.length ? `; ${plural(refused.length, "change", "changes")} can't yet` : ""}.`
            : "None of the waiting changes can apply as they stand."),
        h("ul", { class: "aa-list" },
          state.changes.map((c) =>
            h("li", { key: c.id, class: c.ok ? "aa-ok" : "aa-refused", title: c.ok ? undefined : c.error },
              h("span", { class: "aa-name", title: c.summary ? c.title : undefined }, displayTitle(c)),
              h("span", { class: "aa-effect" }, c.ok ? effectText(c.applied) : `can't apply: ${c.problems[0] ?? c.error}`),
            ))),
        h("div", { class: "aa-row" },
          ready.length > 0
            ? h("button", { type: "button", class: "btn btn-sm aa-confirm", onClick: () => void apply(state.changes) }, `Apply ${ready.length}`)
            : null,
          h("button", { type: "button", class: "aa-link", onClick: () => setState({ step: "idle" }) }, "Cancel"),
        ),
      );
      break;
    }
    case "done": {
      const applied = state.results.filter((r) => r.ok);
      const skipped = state.results.filter((r) => !r.ok);
      body = h("div", { class: "aa-preview", role: "status" },
        h("p", { class: "aa-text" },
          `Applied ${plural(applied.length, "change", "changes")}.`,
          skipped.length ? ` ${plural(skipped.length, "change was", "changes were")} skipped.` : ""),
        skipped.length > 0
          ? h("ul", { class: "aa-list" }, skipped.map((r) =>
              h("li", { key: r.id, class: "aa-refused" },
                h("span", { class: "aa-name" }, displayTitle(r)),
                h("span", { class: "aa-effect" }, r.ok ? "" : r.moved ? "edited since the preview: apply it again" : r.error))))
          : null,
        h("div", { class: "aa-row" }, close),
      );
      break;
    }
  }
  return h("div", { class: "apply-all", "data-step": state.step }, body);
}
