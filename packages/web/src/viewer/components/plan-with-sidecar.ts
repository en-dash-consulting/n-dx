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

/** What decides whether the waiting text can go as the turn. */
export interface PlanFirstTurnState {
  drawerOpen: boolean;
  /** The lens registry has answered. */
  ready: boolean;
  /** The lens the attachment runs now. */
  lens: string;
  busy: boolean;
  /** The open session, if any: its lens and target ref. */
  session: { endedAt?: string; lens?: string; target?: { ref?: string } } | null;
  /** The area the capture targets; null for the whole plan. */
  area: string | null;
  /** The drawer's error line: set when the PATCH re-lensing the open session failed. */
  error: string | null;
}

/** What to do with the waiting text. */
export type PlanFirstTurn =
  | { action: "wait" }
  | { action: "send" }
  /** The open session has ended: start a new one on the Plan lens, then send. */
  | { action: "new-session" }
  /** The turn cannot go; say why and drop the text. */
  | { action: "fail"; reason: string };

/**
 * The text goes once the attachment runs Plan and the open session (when
 * there is one) has followed it to Plan and the target. Before that the turn
 * would open with the old lens or target. When it can never get there (the
 * lens is unavailable, or the session refused to follow) the answer is a
 * reason, not a wait.
 */
export function planFirstTurn(s: PlanFirstTurnState): PlanFirstTurn {
  if (!s.drawerOpen || !s.ready || s.busy) return { action: "wait" };
  if (s.lens !== "plan") return { action: "fail", reason: "Plan with Sidecar could not start: the Plan lens is not available." };
  const held = s.session;
  if (!held) return { action: "send" };
  if (held.endedAt) return { action: "new-session" };
  if (held.lens === "plan" && (held.target?.ref ?? "") === (s.area ?? "")) return { action: "send" };
  if (s.error) return { action: "fail", reason: `Plan with Sidecar could not start: ${s.error}` };
  return { action: "wait" };
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
