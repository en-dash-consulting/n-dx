import { render } from "preact";

type Renderable = Parameters<typeof render>[0];

export function renderToDiv(
  vnode: Renderable,
  options: { attachToBody?: boolean } = {},
): HTMLDivElement {
  const root = document.createElement("div");
  if (options.attachToBody ?? true) {
    document.body.appendChild(root);
  }
  render(vnode, root);
  return root;
}

export function cleanupRenderedDiv(root: HTMLDivElement): void {
  render(null, root);
  root.remove();
}
