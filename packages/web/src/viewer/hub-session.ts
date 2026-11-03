/**
 * The drawer-only viewer entry: the hub session as the hub home docks it.
 *
 * The hub home (hub/home.ts) is server-rendered and imports no Preact, so it
 * frames this page instead: the host builds it beside the dashboard
 * (`dist/viewer/hub-session.html`) and serves it at `/api/sidecar/hub/drawer`,
 * which the hub serves at `/hub/session/drawer` on its own origin. The host
 * injects the page's config — every path it reads, all under `/hub/session/`,
 * and the close message — so the page needs no base path and touches no
 * project's own routes.
 *
 * Closing — the × or ⌘J, whose keystroke lands in this frame — posts the
 * close message to the home that frames it; only the home can undock it. The
 * theme follows the home's `sv-theme` as it changes.
 *
 * @module web/viewer/hub-session
 */

import { h, render } from "preact";
import { useCallback, useEffect, useMemo } from "preact/hooks";
import {
  hubSidecarEndpoint,
  isSidecarShortcut,
  readHubSessionPageConfig,
  requestHubHandoff,
  useHubSessionInfo,
  useSidecar,
  type HubSessionPageConfig,
  type HubSnapshotWorktree,
} from "./hooks/index.js";
import { HubSessionDrawer } from "./components/index.js";

const NO_PAGE = { view: "home", zone: null, taskId: null } as const;
const THEME_KEY = "sv-theme";

/** Ask the framing hub home to undock the drawer. A page opened on its own has nothing to ask. */
export function requestClose(closeMessage: string, win: Window = window): void {
  if (win.parent === win) return;
  win.parent.postMessage({ type: closeMessage }, win.location.origin);
}

/**
 * Go to the worktree's dashboard, which opens its drawer on the handed-off
 * session. The page that frames this drawer navigates, so the operator leaves
 * the hub home for the worktree rather than nesting it in the frame.
 */
export function openWorktreeDashboard(url: string, win: Window = window): void {
  (win.parent === win ? win : win.parent).location.assign(url);
}

export function HubSessionApp({ config }: { config: HubSessionPageConfig }) {
  const endpoint = useMemo(() => hubSidecarEndpoint(config), [config]);
  const sidecar = useSidecar(true, true, NO_PAGE, endpoint);
  const info = useHubSessionInfo(config, true, sidecar.session?.id ?? null, sidecar.running);
  const close = useCallback(() => requestClose(config.closeMessage), [config.closeMessage]);
  const handoff = useCallback(async (worktree: HubSnapshotWorktree): Promise<string | null> => {
    const answer = await requestHubHandoff(config, worktree);
    if ("error" in answer) return answer.error;
    openWorktreeDashboard(answer.url);
    return null;
  }, [config]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSidecarShortcut(e)) return;
      e.preventDefault();
      close();
    };
    // The home's theme toggle writes the key; a storage event reaches every other same-origin document.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const theme = e.newValue === "light" || e.newValue === "dark"
        ? e.newValue
        : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", theme);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("storage", onStorage);
    };
  }, [close]);

  return h(HubSessionDrawer, { sidecar, info, onClose: close, onHandoff: handoff });
}

/** Mount on `root`; a page the host did not serve has no config and says where the drawer lives. */
export function mountHubSession(root: Element, doc: Document = document): void {
  const config = readHubSessionPageConfig(doc);
  render(
    config
      ? h(HubSessionApp, { config })
      : h("p", { class: "sidecar-error", role: "alert" }, "Open the hub session from the hub home: this page is served at /hub/session/drawer."),
    root,
  );
}

const root = typeof document !== "undefined" ? document.getElementById("app") : null;
if (root) mountHubSession(root);
