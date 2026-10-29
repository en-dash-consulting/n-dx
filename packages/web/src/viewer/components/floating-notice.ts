/** Route-local notices join the shell stack without moving their state. */
import { h, type ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useState } from "preact/hooks";

export function FloatingNotice({ children }: { children?: ComponentChildren }) {
  const [stack, setStack] = useState<Element | null>(null);
  useLayoutEffect(() => { setStack(document.querySelector(".status-dock")); }, []);
  // A standalone component preview has no shell. Its notice stays in flow.
  return stack ? createPortal(children, stack) : h("div", null, children);
}
