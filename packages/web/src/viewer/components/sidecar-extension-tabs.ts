/**
 * Extension tabs in the Sidecar drawer (Sidecar design §17.1).
 *
 * An enabled extension may declare one drawer tab. The hub reports it per
 * project in `GET /api/hub/extensions?project=<id>` (`tab`), in its own order,
 * and serves the page only through a frame key: `POST …/extensions/<name>/frame`
 * answers the finished `/x/<name>/~f/<key>/…` URL. The page loads in an iframe
 * sandboxed without `allow-same-origin`, so it never runs with the dashboard's
 * origin, token or cookie. There is no postMessage channel.
 *
 * Like extension-links.ts this asks only once the hub has answered, so a
 * dashboard without the hub shows no strip, and the viewer carries labels and
 * URLs it was given, never extension code.
 *
 * The key request, and the iframe, happen on a tab's first open. A cold sidecar
 * start can take 20 s and an iframe cannot report its own failure, so the page
 * is fetched once first: 503 shows the hub's message and the log file it names,
 * 401 means the key expired.
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getBasePath } from "../base-path.js";
import { extensionLinksPath } from "./extension-links.js";
import type { HubProjects } from "./project-switcher.js";

/** Exactly these; `allow-same-origin` and `allow-top-navigation` are what a tab must never get. */
export const EXTENSION_FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-downloads";

/** One drawer tab as the hub listed it. */
export interface ExtensionTab {
  /** The extension's name: the key request is made for it. */
  name: string;
  label: string;
}

/**
 * The tabs in `GET /api/hub/extensions`' answer, in the hub's order, or null
 * when the body is not that answer. An entry whose URL is not hub-mounted
 * (`/x/…`) is dropped, as for links.
 */
export function parseExtensionTabs(body: unknown): ExtensionTab[] | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { extensions?: unknown }).extensions;
  if (!Array.isArray(list)) return null;
  return list.flatMap((entry) => {
    const e = entry as { name?: unknown; tab?: { label?: unknown; url?: unknown } | null } | null;
    const tab = e?.tab;
    if (typeof e?.name !== "string" || !e.name) return [];
    if (typeof tab?.label !== "string" || !tab.label || typeof tab.url !== "string" || !tab.url.startsWith("/x/")) return [];
    return [{ name: e.name, label: tab.label }];
  });
}

/**
 * Where to ask for `name`'s frame key: the extension list's path (it names the
 * project by prefix or by query) with the extension and `/frame` inserted.
 * Null when the project cannot be told.
 */
export function extensionFramePath(basePath: string, projects: HubProjects["projects"], name: string): string | null {
  const listPath = extensionLinksPath(basePath, projects);
  if (!listPath) return null;
  const [path, query] = listPath.split("?");
  return `${path}/${encodeURIComponent(name)}/frame${query ? `?${query}` : ""}`;
}

/** This project's drawer tabs; empty without a hub or on any failure. */
export function useExtensionTabs(hub: HubProjects, fetcher?: typeof fetch): ExtensionTab[] {
  const [tabs, setTabs] = useState<ExtensionTab[]>([]);
  const path = hub.hub ? extensionLinksPath(getBasePath(), hub.projects) : null;

  useEffect(() => {
    if (!path) { setTabs([]); return; }
    const doFetch = fetcher ?? fetch;
    let cancelled = false;
    void (async () => {
      let next: ExtensionTab[] = [];
      try {
        const res = await doFetch(path, { headers: { accept: "application/json" } });
        if (res.ok) next = parseExtensionTabs(await res.json()) ?? [];
      } catch {
        // A hub that cannot ask n-dx, or a non-JSON body: tabs are an extra,
        // so the drawer simply goes without them.
      }
      if (!cancelled) setTabs(next);
    })();
    return () => { cancelled = true; };
  }, [path]);

  return tabs;
}

// ---------------------------------------------------------------------------
// Opening a tab
// ---------------------------------------------------------------------------

export type ExtensionTabState =
  | { kind: "starting" }
  | { kind: "ready"; url: string }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/** The hub's `{ error, log? }` as one line; `fallback` when the body says nothing. */
async function refusal(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown; log?: unknown };
    const message = typeof body.error === "string" && body.error ? body.error : fallback;
    return typeof body.log === "string" && body.log ? `${message} Log: ${body.log}` : message;
  } catch {
    return fallback;
  }
}

/**
 * Ask for a frame key, then fetch the keyed page once so a cold start (the
 * hub waits up to 20 s for health) or a refusal shows here rather than inside
 * an iframe that cannot say. Resolves to `ready` only when the page answered.
 */
export async function openExtensionTab(
  tab: ExtensionTab,
  framePath: string | null,
  fetcher?: typeof fetch,
): Promise<ExtensionTabState> {
  const doFetch = fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  if (!framePath) return { kind: "error", message: `Could not tell which project ${tab.label} is for` };
  try {
    const keyed = await doFetch(framePath, { method: "POST", headers: { accept: "application/json" } });
    if (keyed.status === 401) return { kind: "expired" };
    if (!keyed.ok) return { kind: "error", message: await refusal(keyed, `${tab.label} could not be opened (${keyed.status})`) };
    const url = (await keyed.json() as { url?: unknown }).url;
    if (typeof url !== "string" || !url.startsWith("/x/")) {
      return { kind: "error", message: `The hub did not give a page for ${tab.label}` };
    }
    // Absolute, so installBasePathFetch leaves it alone: `/x/` is the hub's
    // own mount, and under `/p/<id>/` the key is not a credential (401). No
    // cookie, as for the iframe, so the probe proves what the frame will get.
    const page = await doFetch(new URL(url, location.origin).href, { credentials: "omit" });
    if (page.status === 401) return { kind: "expired" };
    if (!page.ok) return { kind: "error", message: await refusal(page, `${tab.label} answered ${page.status}`) };
    return { kind: "ready", url };
  } catch (err) {
    return { kind: "error", message: `${tab.label} could not be reached: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export const SIDECAR_TAB = "sidecar";

export interface ExtensionTabStripProps {
  tabs: ExtensionTab[];
  /** `SIDECAR_TAB` or an extension's name. */
  active: string;
  onSelect: (id: string) => void;
}

/** Chat first, then the extension tabs, as one segmented control; nothing when there are no extension tabs. */
export function ExtensionTabStrip({ tabs, active, onSelect }: ExtensionTabStripProps) {
  if (tabs.length === 0) return null;
  const entries = [{ id: SIDECAR_TAB, label: "Chat" }, ...tabs.map((t) => ({ id: t.name, label: t.label }))];
  return h("div", { class: "sidecar-tabs", role: "tablist", "aria-label": "Sidecar tabs" },
    entries.map((entry) => h("button", {
      key: entry.id,
      type: "button",
      role: "tab",
      class: `sidecar-tab${entry.id === active ? " active" : ""}`,
      "aria-selected": entry.id === active ? "true" : "false",
      "data-tab": entry.id,
      onClick: () => onSelect(entry.id),
    }, entry.label)),
  );
}

export interface ExtensionTabPanelProps {
  tab: ExtensionTab;
  framePath: string | null;
  /** Hidden, never unmounted, while another tab shows. */
  visible: boolean;
  fetcher?: typeof fetch;
}

/** One extension tab. Mounted on its first open, which is when it asks for its key. */
export function ExtensionTabPanel({ tab, framePath, visible, fetcher }: ExtensionTabPanelProps) {
  const [state, setState] = useState<ExtensionTabState>({ kind: "starting" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "starting" });
    void openExtensionTab(tab, framePath, fetcher).then((next) => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, [tab.name, framePath, attempt]);

  return h("div", { class: "sidecar-panel sidecar-ext-panel", id: `sidecar-tab-${tab.name}`, role: "tabpanel", hidden: !visible },
    state.kind === "starting"
      ? h("p", { class: "sidecar-ext-status", role: "status" }, `Starting ${tab.label}…`)
      : null,
    state.kind === "error"
      ? h("p", { class: "sidecar-ext-status sidecar-ext-error", role: "alert" }, state.message)
      : null,
    state.kind === "expired"
      ? h("p", { class: "sidecar-ext-status sidecar-ext-error", role: "alert" },
          "Expired · ",
          h("button", { type: "button", class: "sidecar-ext-reload", onClick: () => setAttempt((n) => n + 1) }, "Reload"))
      : null,
    state.kind === "ready"
      ? [
          h("div", { key: "bar", class: "sidecar-ext-bar" },
            // The frame cannot report an expired key, so Reload is always on offer.
            h("button", { type: "button", class: "sidecar-ext-reload-frame", onClick: () => setAttempt((n) => n + 1) }, "Reload"),
            h("a", {
              class: "sidecar-ext-popout",
              href: state.url,
              target: "_blank",
              rel: "noopener noreferrer",
            }, "Pop out")),
          h("iframe", {
            key: "frame",
            class: "sidecar-ext-frame",
            src: state.url,
            title: tab.label,
            sandbox: EXTENSION_FRAME_SANDBOX,
          }),
        ]
      : null,
  );
}
