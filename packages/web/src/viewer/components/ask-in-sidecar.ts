/**
 * "Ask Sidecar" on a task page, "Explain in Sidecar" on a capability or zone
 * page: attaches the page's item to the drawer and opens it. The lens is the
 * kind's default: Describe (Diagnose run when the task's newest run failed)
 * for a task, Explain for a capability or zone.
 *
 * main.ts provides {@link AskInSidecarContext} only while `web.sidecar` is on,
 * so nothing is drawn while it is off and no page threads a prop for it.
 */

import { createContext, h } from "preact";
import { useContext } from "preact/hooks";

export type AskInSidecarKind = "task" | "capability" | "zone";

export interface AskInSidecar {
  /** Attach the item with its kind's default lens and open the drawer. */
  ask: (kind: AskInSidecarKind, ref: string) => void;
  /** The item attached by an ask now, if any. */
  attached: { kind: AskInSidecarKind; ref: string } | null;
}

/** Null while `web.sidecar` is off. */
export const AskInSidecarContext = createContext<AskInSidecar | null>(null);

export function AskInSidecarButton({ kind, itemId }: { kind: AskInSidecarKind; itemId: string }) {
  const sidecar = useContext(AskInSidecarContext);
  if (!sidecar) return null;
  const attached = sidecar.attached?.kind === kind && sidecar.attached.ref === itemId;
  return h("button", {
    type: "button",
    class: "btn btn-sm ask-in-sidecar",
    "data-ask-kind": kind,
    "aria-pressed": attached,
    onClick: () => sidecar.ask(kind, itemId),
  }, kind === "task" ? "Ask Sidecar" : "Explain in Sidecar");
}
