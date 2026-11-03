/**
 * "Place with Sidecar": the control a change awaiting placement offers (the
 * Inbox triage page and a change's detail panel both draw it through the
 * placement section). It attaches the change to the Sidecar drawer as a
 * `change` item (ref = the change id), which asks with the Place lens, and
 * opens the drawer.
 *
 * main.ts provides {@link PlaceWithSidecarContext} only while `web.sidecar` is
 * on, so nothing is drawn while it is off and no page threads a prop for it.
 */

import { createContext, h } from "preact";
import { useContext } from "preact/hooks";

export interface PlaceWithSidecar {
  /** Attach the change and open the drawer. */
  place: (changeId: string) => void;
  /** The change attached now, if any. */
  attached: string | null;
}

/** Null while `web.sidecar` is off. */
export const PlaceWithSidecarContext = createContext<PlaceWithSidecar | null>(null);

export function PlaceWithSidecarButton({ changeId }: { changeId: string }) {
  const sidecar = useContext(PlaceWithSidecarContext);
  if (!sidecar) return null;
  const attached = sidecar.attached === changeId;
  return h("button", {
    type: "button",
    class: "ch-change-link cp-place-with-sidecar",
    "aria-pressed": attached,
    onClick: () => sidecar.place(changeId),
  }, attached ? "Placing with Sidecar" : "Place with Sidecar");
}
