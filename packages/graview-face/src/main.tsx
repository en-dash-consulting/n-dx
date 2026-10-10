import { createMemoryAdapter } from "@graview/core";
import { themeCss, type Scheme } from "@graview/primitives";
import { applySettings } from "@graview/react";
import { openStore } from "@graview/ship/browser";
import { loadProjection } from "./app.js";

const sheet = new CSSStyleSheet();
document.adoptedStyleSheets = [sheet];
const STORED = "graview:scheme";

function initialScheme(): Scheme {
  const asked = new URLSearchParams(window.location.search).get("theme");
  if (asked === "light" || asked === "dark") return asked;
  try {
    const stored = localStorage.getItem(STORED);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // A scheme that cannot be remembered still applies for this visit.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/*
 * THE PAGES ARE THE FRONT DOOR. `/` opens the pages; the scene lives at
 * `/scene`, as bee-bot arranges it. Anything else outside the pages' own
 * paths opens the pages, whose router says what it does not know.
 */
function inScene(): boolean {
  const { pathname, search, hash } = window.location;
  if (pathname === "/scene" || pathname.startsWith("/scene/")) return true;
  if (pathname === "/" || pathname === "") {
    const sceneHash = hash.length > 1;
    window.history.replaceState(window.history.state, "", `${sceneHash ? "/scene" : "/pages"}${search}${hash}`);
    return sceneHash;
  }
  if (pathname !== "/pages" && !pathname.startsWith("/pages/")) window.history.replaceState(window.history.state, "", `/pages${search}${hash}`);
  return false;
}

const root = document.getElementById("root");
if (!root) throw new Error("no #root");

/*
 * THE STORE IS THE SNAPSHOT, FRESH EVERY LOAD. n-dx re-emits the projection
 * on every `ndx graview` command and the sync loop (src/sync) re-emits as it
 * pulls, so remembering edits in this browser would only keep yesterday's
 * graph. A memory adapter seeded from the snapshot is the honest store; what
 * a person changes here reaches rex through the loop, and comes back as the
 * next snapshot.
 */
const scheme = initialScheme();
const face = inScene() ? import("./faces/scene.js") : import("./faces/pages.js");

try {
  const projection = await loadProjection();
  const applyScheme = (next: Scheme) => {
    sheet.replaceSync(themeCss(next, projection.app.brand));
    document.documentElement.dataset["graviewScheme"] = next;
    try {
      localStorage.setItem(STORED, next);
    } catch {
      // Not being able to remember is not a reason to fail.
    }
  };
  applyScheme(scheme);
  applySettings(projection.app.settings ?? []);
  const opened = await openStore({ app: projection.app, adapter: createMemoryAdapter(), seed: projection.snapshot, fresh: true });
  (await face).mount(root, { app: projection.app, store: opened.store, scheme, applyScheme });
  (window as unknown as Record<string, unknown>)["__graviewReady"] = { scheme };
} catch (error) {
  root.replaceChildren();
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:2rem;font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap";
  pre.textContent = error instanceof Error ? error.message : String(error);
  root.append(pre);
  throw error;
}
