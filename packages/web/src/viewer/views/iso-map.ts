/**
 * Isometric Map view — generate and inspect the 3D architecture map in-app.
 *
 * The map itself is a complete standalone HTML document produced by
 * `GET /api/iso-map` (see `src/server/routes-iso-map.ts`). It ships its own
 * styles, pan/zoom handlers and keyboard shortcuts, so it is rendered inside an
 * iframe rather than inlined into the viewer DOM — inlining would drop a second
 * `<style>` reset and a `document`-level keydown listener into the dashboard.
 *
 * Two implementation choices worth knowing about:
 *
 *  1. **`srcdoc`, not `src`.** The view fetches the URL itself so that a 404
 *     ("no analysis yet") surfaces as dashboard UI instead of a raw JSON error
 *     page rendered inside the frame, then hands the returned document to the
 *     iframe via `srcdoc`. Setting `src` after a probe request would build the
 *     map twice per generation; `srcdoc` reuses the response we already have.
 *  2. **`sandbox="allow-scripts"`.** The map needs scripts for pan/zoom and
 *     zone selection but touches no storage, forms, popups or same-origin APIs,
 *     so the narrowest sandbox that keeps it interactive is scripts-only. The
 *     document then runs in an opaque origin and cannot reach the dashboard.
 *
 * In deployed (static export) mode there is no server to build the map, so the
 * view renders an explanatory card instead — the same precedent the previous
 * link in `architecture.ts` set.
 *
 * @module web/viewer/views/iso-map
 */

import { h, Fragment } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";
import {
  ISO_MAP_DEFAULTS,
  ISO_MAP_MAX_NODES,
  ISO_MAP_MIN_NODES,
  ISO_MAP_SOURCES,
  ISO_MAP_SOURCE_LABELS,
  buildIsoMapUrl,
  clampMaxNodes,
  ISO_MAP_EMPTY_HEADER,
  isIsoMapSource,
  isoMapDownloadName,
  type IsoMapControls,
  type IsoMapSource,
} from "./iso-map-url.js";
import { appUrl } from "../base-path.js";

export type IsoMapLoadState = "loading" | "ready" | "empty" | "error";

export interface IsoMapError {
  status: number;
  message: string;
  /** True when switching Source to "scan" is a plausible fix. */
  suggestScan: boolean;
}

/** Pull the route's `{ error }` payload out of a failed response. */
async function readRouteError(res: Response): Promise<IsoMapError> {
  let message = `Request failed with status ${res.status}.`;
  try {
    const body = await res.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) {
      message = body.error;
    }
  } catch {
    // Non-JSON body (proxy error page, empty response) — keep the status text.
  }
  return { status: res.status, message, suggestScan: res.status === 404 };
}

export interface IsoMapDocument {
  state: IsoMapLoadState;
  html: string | null;
  error: IsoMapError | null;
  /** The controls that produced the document on screen. */
  applied: IsoMapControls;
  generate: (next: IsoMapControls) => Promise<void>;
}

/**
 * Fetch the map document for a control state and keep it current.
 *
 * Shared by the full Isometric Map view and the Overview's embedded hero, so
 * both regenerate on the same analysis stamp and handle the empty and error
 * responses the same way. Does nothing in deployed mode — there is no server.
 */
export function useIsoMapDocument(analysisStamp: string, deployed: boolean, embed = false): IsoMapDocument {
  const [applied, setApplied] = useState<IsoMapControls>(ISO_MAP_DEFAULTS);
  const [state, setState] = useState<IsoMapLoadState>("loading");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<IsoMapError | null>(null);

  // Guards against a slow first request overwriting a newer one.
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const generate = useCallback(async (next: IsoMapControls) => {
    const seq = ++requestSeqRef.current;
    setApplied(next);
    setState("loading");
    setError(null);
    try {
      const res = await fetch(buildIsoMapUrl(next, { embed }));
      if (!res.ok) {
        const routeError = await readRouteError(res);
        if (!mountedRef.current || seq !== requestSeqRef.current) return;
        setHtml(null);
        setError(routeError);
        setState("error");
        return;
      }
      // A 200 carrying the marker header means the request succeeded and there
      // is simply no map to show — an empty state, not a failure.
      const emptyReason = res.headers.get(ISO_MAP_EMPTY_HEADER);
      const text = await res.text();
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      if (emptyReason) {
        setHtml(null);
        setError({
          status: res.status,
          message:
            emptyReason === "no-analysis"
              ? "No analysis found for this project."
              : "No source files were found in this project.",
          suggestScan: emptyReason === "no-analysis",
        });
        setState("empty");
        return;
      }
      setHtml(text);
      setState("ready");
    } catch (err) {
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      setHtml(null);
      setError({
        status: 0,
        message: err instanceof Error ? err.message : "Failed to reach the dashboard server.",
        suggestScan: false,
      });
      setState("error");
    }
  }, [embed]);

  // Render the default map on first paint so the view is never an empty shell.
  useEffect(() => {
    if (deployed) return;
    void generate(ISO_MAP_DEFAULTS);
  }, [deployed, generate]);

  // Regenerate with the applied controls when the analysis changes (a new
  // run, or narration landing names), so the map never shows stale zones.
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const lastStampRef = useRef(analysisStamp);
  useEffect(() => {
    if (deployed || analysisStamp === lastStampRef.current) return;
    lastStampRef.current = analysisStamp;
    void generate(appliedRef.current);
  }, [analysisStamp, deployed, generate]);

  return { state, html, error, applied, generate };
}

/** The dashboard's resolved theme — `data-theme` on <html>, set by theme-toggle. */
function dashboardTheme(): "light" | "dark" | null {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : null;
}

/**
 * Keep an embedded map in step with the dashboard: its colour scheme follows
 * the theme toggle (not just the OS), and plain-wheel zoom is on only when the
 * host says so — off in the page, where the wheel must scroll the page.
 *
 * The frame is sandboxed to an opaque origin, so postMessage with "*" is the
 * only channel; the message carries no data the map could not already see.
 *
 * `shownHtml` must be the document the frame is showing — null while no frame
 * is mounted — so a rebuild that returns identical HTML still re-binds the
 * remounted frame (the loading state unmounts it).
 */
export function useIsoFrameSync(frameRef: { current: HTMLIFrameElement | null }, wheelZoom: boolean, shownHtml: string | null): void {
  const send = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "ndx-iso", wheelZoom, theme: dashboardTheme() }, "*");
  }, [frameRef, wheelZoom]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    send();
    frame.addEventListener("load", send);
    return () => frame.removeEventListener("load", send);
  }, [send, shownHtml]);

  useEffect(() => {
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [send]);
}

export function IsoMapView({ analysisStamp = "" }: { analysisStamp?: string } = {}) {
  const deployed = isDeployedMode();
  const cliName = useCliName();

  // Pending control state (what the form shows) is kept separate from the
  // applied state (what produced the document on screen) so that editing the
  // controls never silently invalidates the map the user is looking at.
  const [controls, setControls] = useState<IsoMapControls>(ISO_MAP_DEFAULTS);
  const { state, html, error, applied, generate } = useIsoMapDocument(analysisStamp, deployed, true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  useIsoFrameSync(frameRef, false, state === "ready" ? html : null);

  const appliedUrl = buildIsoMapUrl(applied);

  const handleSource = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    if (!isIsoMapSource(value)) return;
    setControls((prev) => ({ ...prev, source: value as IsoMapSource }));
  }, []);

  const handleMaxNodes = useCallback((e: Event) => {
    const raw = Number.parseInt((e.target as HTMLInputElement).value, 10);
    setControls((prev) => ({ ...prev, maxNodes: clampMaxNodes(raw) }));
  }, []);

  const handleExternals = useCallback((e: Event) => {
    const checked = (e.target as HTMLInputElement).checked;
    setControls((prev) => ({ ...prev, includeExternals: checked }));
  }, []);

  const header = h("div", { class: "view-header" },
    h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
    h("h2", { class: "section-header" }, "Isometric Map"),
  );

  if (deployed) {
    return h("div", { class: "iso-map-view" },
      header,
      h("p", { class: "section-sub" },
        "A 3D isometric view of this codebase's zones and the imports between them.",
      ),
      h("div", { class: "card iso-map-unavailable", role: "status" },
        h("h3", { class: "section-header-sm" }, "Not available in the exported dashboard"),
        h("p", null,
          "The isometric map is built on demand by the n-dx server, which is not part of a static export. ",
          "Run ", h("code", null, `${cliName} start .`), " on the project and open this view there.",
        ),
      ),
    );
  }

  return h("div", { class: "iso-map-view" },
    header,
    h("p", { class: "section-sub" },
      "A 3D isometric view of this codebase's zones and the imports between them. ",
      "Drag to pan, Ctrl/⌘ + scroll or pinch to zoom, click a zone to inspect it.",
    ),

    // ── Generation controls ───────────────────────────────────────────
    h("form", {
      class: "cmd-panel iso-map-controls",
      onSubmit: (e: Event) => {
        e.preventDefault();
        void generate(controls);
      },
    },
      h("div", { class: "iso-map-fields" },
        h("div", { class: "cmd-panel-form" },
          h("label", { class: "cmd-panel-label", for: "iso-map-source" }, "Source"),
          h("select", {
            id: "iso-map-source",
            class: "cmd-panel-input",
            value: controls.source,
            disabled: state === "loading",
            onChange: handleSource,
          },
            ISO_MAP_SOURCES.map((source) =>
              h("option", { key: source, value: source }, ISO_MAP_SOURCE_LABELS[source]),
            ),
          ),
          h("p", { class: "cmd-panel-hint" },
            "Auto prefers ", h("code", null, ".sourcevision"), " analysis and falls back to a direct scan.",
          ),
        ),

        h("div", { class: "cmd-panel-form" },
          h("label", { class: "cmd-panel-label", for: "iso-map-max-nodes" }, "Max nodes"),
          h("input", {
            id: "iso-map-max-nodes",
            type: "number",
            class: "cmd-panel-input cmd-panel-input-narrow",
            min: ISO_MAP_MIN_NODES,
            max: ISO_MAP_MAX_NODES,
            step: 1,
            value: String(controls.maxNodes),
            disabled: state === "loading",
            onInput: handleMaxNodes,
          }),
          h("p", { class: "cmd-panel-hint" },
            `${ISO_MAP_MIN_NODES}–${ISO_MAP_MAX_NODES} zones, largest by file count first.`,
          ),
        ),

        h("div", { class: "cmd-panel-form" },
          h("label", { class: "cmd-panel-label cmd-panel-label-inline", for: "iso-map-externals" },
            h("input", {
              id: "iso-map-externals",
              type: "checkbox",
              checked: controls.includeExternals,
              disabled: state === "loading",
              onChange: handleExternals,
            }),
            " Include external packages",
          ),
          h("p", { class: "cmd-panel-hint" },
            "Gives shared third-party dependencies their own column.",
          ),
        ),
      ),

      h("div", { class: "cmd-panel-actions" },
        h("button", {
          type: "submit",
          class: "cmd-btn cmd-btn-primary",
          disabled: state === "loading",
        }, state === "loading"
          ? "Generating…"
          : html !== null ? "Regenerate" : "Generate"),
        // The in-app fetch is base-path aware (installBasePathFetch); a raw
        // href is not, and under the hub `/api/iso-map` at the root answers
        // 409 "several projects are registered". Prefix it here.
        h("a", {
          class: "cmd-btn cmd-btn-secondary",
          href: appUrl(appliedUrl),
          target: "_blank",
          rel: "noopener noreferrer",
        }, "Open in new tab"),
        h("a", {
          class: "cmd-btn cmd-btn-secondary",
          href: appUrl(appliedUrl),
          download: isoMapDownloadName(applied),
        }, "Download HTML"),
      ),
    ),

    // ── Map surface ───────────────────────────────────────────────────
    h("div", { class: "iso-map-surface" },
      state === "loading"
        ? h("div", { class: "iso-map-placeholder", role: "status", "aria-live": "polite" },
            h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
            h("span", null, "Building the isometric map…"),
          )
        : null,

      (state === "error" || state === "empty") && error
        ? h("div", { class: "card iso-map-error", role: state === "empty" ? "status" : "alert" },
            h("h3", { class: "section-header-sm" },
              state === "empty" ? "Nothing to map yet" : "Could not build the map",
            ),
            h("p", null, error.message),
            error.suggestScan
              ? h("p", { class: "cmd-panel-hint" },
                  "Run ", h("code", null, `${cliName} analyze .`), " to produce a zone map, ",
                  "or switch Source to “Direct scan” and generate again.",
                )
              : null,
          )
        : null,

      state === "ready" && html !== null
        ? h(Fragment, null,
            h("iframe", {
              ref: frameRef,
              class: "iso-map-frame",
              title: "Isometric architecture map",
              srcdoc: html,
              sandbox: "allow-scripts",
            }),
            h("p", { class: "cmd-panel-hint iso-map-caption" },
              `Source: ${ISO_MAP_SOURCE_LABELS[applied.source]} · up to ${applied.maxNodes} zones · `
              + `externals ${applied.includeExternals ? "on" : "off"}`,
            ),
          )
        : null,
    ),
  );
}

// ── Embedded hero ──────────────────────────────────────────────

export interface IsoMapHeroProps {
  analysisStamp?: string;
  /** Opens the full Isometric Map view, where source and node count are set. */
  onOpenOptions?: () => void;
  /** Short facts shown beside the title — "43 zones", "2,239 files". */
  facts?: readonly string[];
}

/**
 * The map as the Overview's lead: default controls, no form, and an Expand
 * button that takes it full screen. Expand uses the Fullscreen API, so Esc
 * leaves it even while focus is inside the iframe; where the API is missing
 * the hero falls back to a fixed overlay with its own Close button.
 *
 * The frame holds the map's embedded document, which never scrolls and leaves
 * a plain wheel to the page — so scrolling past the map scrolls the page.
 * Zoom is Ctrl/⌘ + scroll or pinch in place, and the plain wheel while
 * expanded, where there is no page to scroll.
 *
 * Renders nothing in deployed mode — the Overview has plenty to show without
 * a card explaining why the map is absent.
 */
export function IsoMapHero({ analysisStamp = "", onOpenOptions, facts = [] }: IsoMapHeroProps) {
  const deployed = isDeployedMode();
  const cliName = useCliName();
  const { state, html, error, applied, generate } = useIsoMapDocument(analysisStamp, deployed, true);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(false);
  // True when `expanded` is the CSS overlay rather than real full screen.
  const [overlay, setOverlay] = useState(false);
  useIsoFrameSync(frameRef, expanded, state === "ready" ? html : null);

  useEffect(() => {
    const sync = () => {
      if (!overlay) setExpanded(document.fullscreenElement === rootRef.current && rootRef.current !== null);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [overlay]);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOverlay(false); setExpanded(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay]);

  const toggleExpanded = useCallback(() => {
    const el = rootRef.current;
    if (expanded) {
      if (overlay) { setOverlay(false); setExpanded(false); }
      else void document.exitFullscreen?.();
      return;
    }
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => { setOverlay(true); setExpanded(true); });
    } else {
      setOverlay(true);
      setExpanded(true);
    }
  }, [expanded, overlay]);

  if (deployed) return null;

  // New tab and download get the standalone page, not the embedded document.
  const standaloneUrl = buildIsoMapUrl(applied);

  return h("section", {
    ref: rootRef,
    class: `iso-hero${expanded ? " iso-hero--expanded" : ""}${overlay ? " iso-hero--overlay" : ""}`,
    role: overlay ? "dialog" : undefined,
    "aria-label": "Codebase map",
  },
    h("header", { class: "iso-hero-bar" },
      h("div", { class: "iso-hero-heading" },
        h("span", { class: "iso-hero-mark", "aria-hidden": "true" }, "◆"),
        h("h3", { class: "iso-hero-title" }, "Codebase map"),
        facts.length > 0
          ? h("ul", { class: "iso-hero-facts", "aria-label": "Map summary" },
              facts.map((f) => h("li", { key: f }, f)),
            )
          : null,
      ),
      h("div", { class: "iso-hero-actions" },
        h("span", { class: "iso-hero-hint" },
          "Click a block for details · double-click to open it · ",
          expanded ? "scroll to zoom" : "Ctrl/⌘ + scroll to zoom",
        ),
        state === "ready"
          ? h("button", {
              type: "button",
              class: "iso-hero-btn",
              onClick: () => void generate(applied),
              title: "Rebuild the map from the current analysis",
            }, h("span", { "aria-hidden": "true" }, "↻"), "Rebuild")
          : null,
        onOpenOptions && !expanded
          ? h("button", {
              type: "button",
              class: "iso-hero-btn",
              onClick: onOpenOptions,
              title: "Change the source, node count and external packages",
            }, "Options")
          : null,
        h("a", {
          class: "iso-hero-btn",
          href: appUrl(standaloneUrl),
          target: "_blank",
          rel: "noopener noreferrer",
          title: "Open the map on its own in a new tab",
        }, "New tab", h("span", { "aria-hidden": "true" }, "↗")),
        h("button", {
          type: "button",
          class: "iso-hero-btn iso-hero-btn--primary",
          onClick: toggleExpanded,
          "aria-pressed": String(expanded),
          title: expanded ? "Leave full screen (Esc)" : "Show the map full screen",
        }, h("span", { "aria-hidden": "true" }, expanded ? "✕" : "⛶"), expanded ? "Close" : "Expand"),
      ),
    ),
    h("div", { class: "iso-hero-stage" },
      state === "loading"
        ? h("div", { class: "iso-hero-placeholder", role: "status", "aria-live": "polite" },
            h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
            h("span", null, "Building the map…"),
          )
        : null,
      (state === "error" || state === "empty") && error
        ? h("div", { class: "iso-hero-placeholder iso-hero-placeholder--msg", role: state === "empty" ? "status" : "alert" },
            h("strong", null, state === "empty" ? "Nothing to map yet" : "Could not build the map"),
            h("span", null, error.message),
            error.suggestScan
              ? h("span", { class: "cmd-panel-hint" },
                  "Run ", h("code", null, `${cliName} analyze .`), " or re-analyze above.",
                )
              : null,
          )
        : null,
      state === "ready" && html !== null
        ? h("iframe", {
            ref: frameRef,
            class: "iso-hero-frame",
            title: "Isometric architecture map",
            srcdoc: html,
            sandbox: "allow-scripts",
          })
        : null,
    ),
  );
}
