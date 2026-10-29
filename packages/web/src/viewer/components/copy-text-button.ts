/**
 * CopyTextButton — copies a fixed text (a command, a diff) to the clipboard.
 *
 * Says when the clipboard refuses, since the text it copies stays on screen
 * to be selected by hand. Used by the Prepare task modal and the Workspaces
 * branch health strip.
 */

import { h } from "preact";
import { useCallback, useState } from "preact/hooks";

export interface CopyTextButtonProps {
  text: string;
  /** CSS class for the button. */
  class?: string;
  /** Accessible name. Default: "Copy the command". */
  label?: string;
}

export function CopyTextButton({ text, class: className, label = "Copy the command" }: CopyTextButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard refused (permissions, insecure context): say so; the text stays selectable.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }, [text]);
  return h("button", { type: "button", class: className, onClick: copy, "aria-label": label },
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select it" : "Copy");
}
