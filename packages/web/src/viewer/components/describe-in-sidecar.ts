/**
 * "Describe in Sidecar" / "Tighten with Sidecar": the controls an open change
 * offers on Plan (Open changes rows, Specs to tighten lines). Each attaches the
 * change to the drawer with the Describe lens, which flags vague criteria and
 * proposes tighter ones, and opens the drawer.
 *
 * main.ts provides {@link DescribeInSidecarContext} only while `web.sidecar` is
 * on, so nothing is drawn while it is off and no page threads a prop for it.
 */

import { createContext, h } from "preact";
import { useContext } from "preact/hooks";

export interface DescribeInSidecar {
  /** Attach the change with the Describe lens and open the drawer. */
  describe: (changeId: string) => void;
  /** The change attached with Describe now, if any. */
  attached: string | null;
}

/** Null while `web.sidecar` is off. */
export const DescribeInSidecarContext = createContext<DescribeInSidecar | null>(null);

export interface DescribeInSidecarButtonProps {
  changeId: string;
  /** The button's text; "Describe in Sidecar" by default. */
  label?: string;
  class?: string;
}

export function DescribeInSidecarButton({ changeId, label = "Describe in Sidecar", class: cls = "ch-change-link" }: DescribeInSidecarButtonProps) {
  const sidecar = useContext(DescribeInSidecarContext);
  if (!sidecar) return null;
  return h("button", {
    type: "button",
    class: `${cls} describe-in-sidecar`,
    "aria-pressed": sidecar.attached === changeId,
    onClick: () => sidecar.describe(changeId),
  }, label);
}
