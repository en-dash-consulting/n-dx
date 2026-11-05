/**
 * "Plan with Sidecar": the control beside Preview on a capture bar. It opens
 * the drawer on the Plan lens and sends the typed text as the session's first
 * turn; from an area-scoped capture the session targets that area. The answer
 * is a change-set card, so nothing is written until the operator approves it.
 *
 * main.ts provides {@link PlanWithSidecarContext} only while `web.sidecar` is
 * on, so nothing is drawn while it is off and no page threads a prop for it.
 */

import { createContext, h } from "preact";
import { useContext } from "preact/hooks";

export interface PlanWithSidecar {
  /** Attach the Plan lens (and `areaId`, when given), open the drawer and send `text`. */
  plan: (text: string, areaId?: string) => void;
}

/** Null while `web.sidecar` is off. */
export const PlanWithSidecarContext = createContext<PlanWithSidecar | null>(null);

export interface PlanWithSidecarButtonProps {
  /** What the capture bar holds; trimmed before it is sent. */
  text: string;
  /** The area the capture is scoped to. */
  areaId?: string;
  disabled?: boolean;
}

export function PlanWithSidecarButton({ text, areaId, disabled }: PlanWithSidecarButtonProps) {
  const sidecar = useContext(PlanWithSidecarContext);
  if (!sidecar) return null;
  return h("button", {
    type: "button",
    class: "cmd-btn cmd-btn-secondary smart-add-btn-sidecar",
    disabled: disabled || text.trim().length === 0,
    title: areaId ? "Plan this in the area with the Sidecar" : "Plan this with the Sidecar",
    onClick: () => sidecar.plan(text.trim(), areaId),
  }, "Plan with Sidecar");
}
