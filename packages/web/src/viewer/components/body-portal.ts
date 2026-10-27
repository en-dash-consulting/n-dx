/**
 * Render a dialog at the end of `<body>` instead of where it was opened.
 *
 * A `position: fixed` dialog's z-index only competes inside its nearest
 * stacking context. Opened from inside page content, that context is whatever
 * ancestor happens to make one: the top nav (z 20), the bottom bar (z 41), or
 * a dashboard card lifted over its decoration (`decorations.css` gives every
 * child of `.rex-dash-next` and its siblings `z-index: 1`). Then `--z-modal`
 * means nothing, and the page paints over the dialog. Mounted under `<body>`,
 * the dialog has only the root context above it, so the `--z-*` scale holds.
 *
 * Built on core `render()` rather than `preact/compat`'s `createPortal`, which
 * would install compat's global option hooks for the whole viewer. The cost is
 * a separate render root: context does not cross it (the viewer uses none),
 * and DOM events bubble to `<body>`, not to the component that opened it.
 */

import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";

export function BodyPortal({ children }: { children: ComponentChildren }) {
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "body-portal";
    return el;
  });

  useLayoutEffect(() => {
    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, [host]);

  // Every render of the owner re-renders the portal, so props flow as usual.
  useLayoutEffect(() => {
    render(children, host);
  });

  return null;
}
