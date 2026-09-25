import { render } from "preact";
import { act } from "preact/test-utils";

type Renderable = Parameters<typeof render>[0];

export function renderToDiv(
  vnode: Renderable,
  options: { attachToBody?: boolean } = {},
): HTMLDivElement {
  const root = document.createElement("div");
  if (options.attachToBody ?? true) {
    document.body.appendChild(root);
  }
  // act() so any mount effect with changed deps commits synchronously here
  // instead of arming Preact's real requestAnimationFrame/setTimeout(35)
  // after-paint fallback, which would otherwise outlive this test file.
  act(() => { render(vnode, root); });
  return root;
}

export function cleanupRenderedDiv(root: HTMLDivElement): void {
  act(() => { render(null, root); });
  root.remove();
}
