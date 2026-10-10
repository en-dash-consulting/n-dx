import { EMPTY_VIEW } from "@graview/layout";
import { Shell } from "@graview/primitives";
import { GraviewProvider, type Scheme } from "@graview/react";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Mount } from "./pages.js";
import { views } from "../ui/views.js";

/**
 * THE SPATIAL FACE: Graview's own shell — the bar, the city, the inspector,
 * the rail — over the same store and the same pictures. Nothing custom here
 * on purpose: the declaration's lenses and glance carry it, and the pages
 * face is where n-dx's own words live.
 */
function SceneApp({ app, store, scheme: initial, applyScheme }: Mount) {
  const registry = useMemo(() => views(app), [app]);
  const [scheme, setScheme] = useState<Scheme>(initial);
  return (
    <GraviewProvider store={store} views={registry} initialView={{ ...EMPTY_VIEW, overview: true }} scheme={scheme} brand={app.brand} settings={app.settings ?? []}>
      <Shell
        standing="Every change names what it waits for, and nothing closed has open work under it."
        pagesHref="/pages"
        remembers={false}
        syncUrl
        scheme={scheme}
        onScheme={(next) => {
          setScheme(next);
          applyScheme(next);
        }}
      />
    </GraviewProvider>
  );
}

export function mount(root: HTMLElement, props: Mount): void {
  createRoot(root).render(<SceneApp {...props} />);
}
