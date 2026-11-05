/**
 * Apply… for a change awaiting apply (completed, not applied), in its detail
 * panel. Other changes show nothing.
 *
 * Apply… asks `POST /api/rex/changes/:id/apply/preview`, which writes nothing,
 * and lists each amendment with the product node it creates, edits or retires.
 * Only Apply in that preview writes, through `…/apply`: rex's apply, the one
 * MCP `apply_change` runs. A refusal from either shows rex's message.
 * Apply sends the preview's hash; when the change or a node it amends was
 * edited since (409 `moved`), the panel re-reads the preview and says so.
 *
 * @module viewer/components/prd-tree/change-apply
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import { useRefetchableProductRead } from "../../hooks/index.js";
import type { AppliedAmendment, ChangeApply, ChangeRow } from "../../views/product-model.js";

type Answer = { ok: true; result: ChangeApply } | { ok: false; message: string; moved?: boolean };

/** Apply sends the preview's hash: rex refuses (409 `moved`) when the change or its targets were edited since. */
async function post(changeId: string, action: "apply" | "apply/preview", hash?: string): Promise<Answer> {
  try {
    const res = await fetch(`/api/rex/changes/${encodeURIComponent(changeId)}/${action}`, {
      method: "POST",
      ...(hash !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }) } : {}),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.ok) return { ok: true, result: json as unknown as ChangeApply };
    return { ok: false, message: typeof json?.error === "string" ? json.error : `HTTP ${res.status}`, ...(json?.moved === true ? { moved: true } : {}) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const label = (node: { id: string; displayId?: string; title: string }) => `${node.displayId ?? node.id.slice(0, 8)} ${node.title}`;

export const MOVED_NOTICE = "Nothing was applied: this change or a product node it amends was edited since the preview. This is what applying would do now; review it and apply again.";

const EFFECT: Record<AppliedAmendment["delta"], string> = { added: "Adds", modified: "Edits", removed: "Retires" };

/** One line per amendment: what it does to which node on the product map. */
export function effectLine(a: AppliedAmendment): string {
  const where = a.delta === "added" && a.under ? ` under ${label(a.under)}` : "";
  return `${EFFECT[a.delta]} ${a.node.type} ${label(a.node)}${where}: ${a.summary}`;
}

type Step =
  | { kind: "idle" }
  | { kind: "busy" }
  /** `moved`: an Apply was refused because this preview replaced the one it was approved on. */
  | { kind: "preview"; preview: ChangeApply; moved?: boolean }
  | { kind: "refused"; message: string }
  | { kind: "applied"; result: ChangeApply };

export interface ChangeApplySectionProps {
  changeId: string;
  /** After the apply wrote: refresh the tree and anything else reading the PRD. */
  onWritten?: () => void;
}

/** Key it by change id: its state belongs to one change. */
export function ChangeApplySection({ changeId, onWritten }: ChangeApplySectionProps) {
  const { load, refetch } = useRefetchableProductRead("/api/rex/changes", (body) => body.changes as ChangeRow[]);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const row = load.state === "ready" ? load.data.find((c) => c.id === changeId) : undefined;

  if (step.kind === "applied") {
    return h("div", { class: "task-section ca-section", "data-change-apply": "applied" },
      h("div", { class: "cp-placed-line" }, `Applied. ${step.result.applied.length ? `${step.result.applied.length} amendment${step.result.applied.length === 1 ? "" : "s"} on the product map.` : "It carried no amendments."}`),
    );
  }
  if (row?.stage !== "awaiting-apply") return null;

  const preview = async (moved?: boolean) => {
    setStep({ kind: "busy" });
    const answer = await post(changeId, "apply/preview");
    setStep(answer.ok ? { kind: "preview", preview: answer.result, ...(moved ? { moved } : {}) } : { kind: "refused", message: answer.message });
  };
  const apply = async (hash: string) => {
    setStep({ kind: "busy" });
    const answer = await post(changeId, "apply", hash);
    if (!answer.ok) {
      // Someone else edited it since: show what applying would do now, and say why.
      if (answer.moved) await preview(true);
      else setStep({ kind: "refused", message: answer.message });
      return;
    }
    setStep({ kind: "applied", result: answer.result });
    refetch();
    onWritten?.();
  };
  const busy = step.kind === "busy";

  return h("section", { class: "task-section ca-section", "aria-label": "Apply", "data-change-apply": step.kind },
    h("div", { class: "cp-note", role: "note" }, "Its work is done. Applying puts its amendments on the product map."),
    step.kind === "preview"
      ? h("div", { class: "ca-preview" },
          step.moved
            ? h("div", { class: "cp-refusal ca-moved", role: "alert" }, h("div", { class: "cp-refusal-message" }, MOVED_NOTICE))
            : null,
          step.preview.applied.length
            ? h("ul", { class: "ca-effects" }, step.preview.applied.map((a) => h("li", { key: `${a.delta}:${a.node.id}`, class: "ca-effect", "data-delta": a.delta }, effectLine(a))))
            : h("div", { class: "ca-effects-empty" }, "It carries no amendments: applying records it as applied and changes no node."),
          h("div", { class: "cp-actions" },
            h("button", { type: "button", class: "btn btn-sm ca-confirm", onClick: () => apply(step.preview.hash) }, "Apply"),
            h("button", { type: "button", class: "ch-change-link ca-cancel", onClick: () => setStep({ kind: "idle" }) }, "Cancel"),
          ),
        )
      : h("div", { class: "cp-actions" },
          h("button", { type: "button", class: "btn btn-sm ca-open", disabled: busy, onClick: () => preview() }, busy ? "Checking…" : "Apply…"),
        ),
    step.kind === "refused"
      ? h("div", { class: "cp-refusal", role: "alert" }, h("div", { class: "cp-refusal-message" }, step.message))
      : null,
  );
}
