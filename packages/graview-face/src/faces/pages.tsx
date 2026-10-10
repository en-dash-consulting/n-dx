import type { AnySchema, Store } from "@graview/core";
import { PagesApp } from "@graview/pages";
import type { Scheme } from "@graview/primitives";
import { createRoot } from "react-dom/client";
import type { App } from "../app.js";
import { pages } from "../ui/pages.js";
import { views } from "../ui/views.js";
import { SchemeContext } from "../ui/scheme.js";
import { startSync } from "../sync/engine.js";
import { setSync } from "../ui/sync-status.js";

export interface Mount {
  readonly app: App;
  readonly store: Store<AnySchema>;
  readonly scheme: Scheme;
  readonly applyScheme: (scheme: Scheme) => void;
}

/**
 * TWO-WAY, WHEN THE DOOR IS OPEN. The dev server says whether rex is behind
 * it (`ndx graview serve .` sets the endpoint); then the sync loop runs over
 * this store and every edit here becomes a rex write.
 */
async function connect(store: Mount["store"]): Promise<void> {
  try {
    const info = (await (await fetch("/ndx/sync-info")).json()) as { rex?: boolean };
    if (!info.rex) return;
    const who = (() => {
      try {
        return localStorage.getItem("graview:principal") ?? "reader";
      } catch {
        return "reader";
      }
    })();
    setSync(startSync({ store, principal: who }));
  } catch {
    // No door (a static build): read-only, and the rail says so.
  }
}

/** The routed, responsive face: the front door. */
export function mount(root: HTMLElement, { app, store, scheme, applyScheme }: Mount): void {
  void connect(store);
  createRoot(root).render(
    <SchemeContext.Provider value={{ initial: scheme, apply: applyScheme }}>
      <PagesApp
        basename="/pages"
        context={{
          store,
          brand: app.brand,
          sceneHref: "/scene",
          remembers: false,
          // The same pictures on both faces: the registry the scene draws from, so every titled lens is a place here too.
          views: views(app),
          settings: app.settings ?? [],
        }}
        registry={pages(app)}
      />
    </SchemeContext.Provider>,
  );
}
