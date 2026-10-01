/**
 * Route state management hook for the viewer app.
 *
 * Manages the active view, selected entity IDs (file, zone, run, task),
 * URL history synchronisation, and backward-compat migration of legacy hash URLs.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { ViewId, NavigateTo, AskSeed } from "../types.js";
import { isTaskRouteView, normalizeLiveView, parseLegacyHashRoute, resolveLocationRoute, viewPathname } from "../route-state.js";
import { appUrl, getBasePath } from "../base-path.js";
import { resolveViewAlias } from "../external.js";
import { guardedLeave } from "./use-leave-guard.js";

export interface RouteState {
  view: ViewId;
  selectedFile: string | null;
  setSelectedFile: (file: string | null) => void;
  selectedZone: string | null;
  selectedRunId: string | null;
  selectedTaskId: string | null;
  /**
   * The item the Ask panel was entered with, when it was entered from one.
   *
   * Carried in route state alongside the scalar selections rather than in the
   * URL: it is a structured object with no readable path form, and a shareable
   * `/ask` link that silently loses its grounding would be worse than one that
   * plainly opens an empty panel. It rides in the history entry's state, so
   * Back returns to the seeded panel rather than a bare one.
   */
  askSeed: AskSeed | null;
  navigateTo: NavigateTo;
  handleSidebarNav: (id: ViewId) => void;
}

/** The full shape carried in a history entry — and the route state it drives. */
interface HistoryEntry {
  view: ViewId;
  file: string | null;
  zone: string | null;
  runId: string | null;
  taskId: string | null;
  askSeed: AskSeed | null;
}

function entryUrl(entry: HistoryEntry): string {
  const subId = entry.runId ?? entry.taskId;
  return viewPathname(entry.view, subId);
}

/**
 * The page a bare URL opens on: the landing page whenever it exists (it is a
 * cross-cutting view, so it does in every scope), else the first valid view.
 */
function defaultView(validViews: Set<ViewId>): ViewId {
  if (validViews.has("home")) return "home";
  return validViews.values().next().value as ViewId;
}

function getInitialView(validViews: Set<ViewId>): ViewId {
  const parsed = resolveLocationRoute(location.pathname, location.hash, validViews, getBasePath());
  return parsed?.view ?? defaultView(validViews);
}

function getInitialRunId(validViews: Set<ViewId>): string | null {
  const parsed = resolveLocationRoute(location.pathname, location.hash, validViews, getBasePath());
  if (!parsed || parsed.view !== "hench-runs") return null;
  return parsed.subId;
}

function getInitialTaskId(validViews: Set<ViewId>): string | null {
  const parsed = resolveLocationRoute(location.pathname, location.hash, validViews, getBasePath());
  if (!parsed || !isTaskRouteView(parsed.view)) return null;
  return parsed.subId;
}

export function useRouteState(validViews: Set<ViewId>): RouteState {
  const [view, setView] = useState<ViewId>(() => getInitialView(validViews));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => getInitialRunId(validViews));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => getInitialTaskId(validViews));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [askSeed, setAskSeed] = useState<AskSeed | null>(null);

  // Mirrors the current route outside React state so the popstate handler
  // (registered once, deps []) can re-push "where we were" when the leave
  // guard blocks a back/forward navigation. `location` can't tell us that at
  // that point — the browser has already moved it to the popped entry by the
  // time the event fires.
  const currentRef = useRef<HistoryEntry>({
    view, file: selectedFile, zone: selectedZone, runId: selectedRunId, taskId: selectedTaskId, askSeed,
  });
  useEffect(() => {
    currentRef.current = { view, file: selectedFile, zone: selectedZone, runId: selectedRunId, taskId: selectedTaskId, askSeed };
  }, [view, selectedFile, selectedZone, selectedRunId, selectedTaskId, askSeed]);

  const applyEntry = useCallback((raw: HistoryEntry, push: boolean) => {
    const entry = { ...raw, view: normalizeLiveView(raw.view, raw.taskId) };
    setSelectedFile(entry.file);
    setSelectedZone(entry.zone);
    setSelectedRunId(entry.runId);
    setSelectedTaskId(entry.taskId);
    setAskSeed(entry.askSeed);
    setView(entry.view);
    currentRef.current = entry;
    if (push) history.pushState(entry, "", appUrl(entryUrl(entry)));
  }, []);

  const navigateTo: NavigateTo = useCallback((targetView, opts) => {
    // A caller may still pass an old id (the bottom-bar's freshness/completion
    // indicators do, via INDICATOR_VIEWS) — resolve it to the stage that
    // absorbed it so the URL and the lit tab both land on the current view.
    const resolved = resolveViewAlias(targetView, validViews) ?? targetView;
    const entry: HistoryEntry = {
      view: resolved,
      file: opts?.file ?? null,
      zone: opts?.zone ?? null,
      runId: opts?.runId ?? null,
      taskId: opts?.taskId ?? null,
      askSeed: opts?.askSeed ?? null,
    };
    guardedLeave(() => applyEntry(entry, true));
  }, [validViews, applyEntry]);

  const handleSidebarNav = useCallback((id: ViewId) => {
    const resolved = resolveViewAlias(id, validViews) ?? id;
    const entry: HistoryEntry = { view: resolved, file: null, zone: null, runId: null, taskId: null, askSeed: null };
    guardedLeave(() => applyEntry(entry, true));
  }, [validViews, applyEntry]);

  useEffect(() => {
    // Backward compat: migrate old hash URLs to path URLs
    const hashRoute = parseLegacyHashRoute(location.hash, validViews);
    if (hashRoute) {
      const isRunView = hashRoute.view === "hench-runs";
      const isTaskView = isTaskRouteView(hashRoute.view);
      const entry: HistoryEntry = {
        view: hashRoute.view,
        file: null,
        zone: null,
        runId: isRunView ? hashRoute.subId : null,
        taskId: isTaskView ? hashRoute.subId : null,
        askSeed: null,
      };
      setSelectedFile(entry.file);
      setSelectedZone(entry.zone);
      setSelectedRunId(entry.runId);
      setSelectedTaskId(entry.taskId);
      setAskSeed(entry.askSeed);
      setView(entry.view);
      currentRef.current = entry;
      history.replaceState(entry, "", appUrl(entryUrl(entry)));
    } else {
      // Seed the initial history entry — preserve deep-link path if present
      const entry: HistoryEntry = {
        view, file: selectedFile, zone: selectedZone, runId: selectedRunId, taskId: selectedTaskId, askSeed: null,
      };
      currentRef.current = entry;
      history.replaceState(entry, "", appUrl(entryUrl(entry)));
    }

    const handlePopState = (e: PopStateEvent) => {
      const entryFor = (): HistoryEntry => {
        if (e.state) {
          const s = e.state as {
            view?: string;
            file?: string | null;
            zone?: string | null;
            runId?: string | null;
            taskId?: string | null;
            askSeed?: AskSeed | null;
          };
          if (s.view && validViews.has(s.view as ViewId)) {
            return {
              view: s.view as ViewId,
              file: s.file ?? null,
              zone: s.zone ?? null,
              runId: s.runId ?? null,
              taskId: s.taskId ?? null,
              askSeed: s.askSeed ?? null,
            };
          }
        }

        const parsed = resolveLocationRoute(location.pathname, location.hash, validViews, getBasePath())
          ?? { view: defaultView(validViews), subId: null };
        const isRunView = parsed.view === "hench-runs";
        const isTaskView = isTaskRouteView(parsed.view);
        return {
          view: parsed.view,
          file: null,
          zone: null,
          runId: isRunView ? parsed.subId : null,
          taskId: isTaskView ? parsed.subId : null,
          askSeed: null,
        };
      };
      const picked = entryFor();
      const target = { ...picked, view: normalizeLiveView(picked.view, picked.taskId) };

      const applied = guardedLeave(() => {
        setSelectedFile(target.file);
        setSelectedZone(target.zone);
        setSelectedRunId(target.runId);
        setSelectedTaskId(target.taskId);
        setAskSeed(target.askSeed);
        setView(target.view);
        currentRef.current = target;
        // Fixes up the address bar for the deferred (Discard) case, where our
        // own re-push below already moved it; a no-op when applied immediately,
        // since the browser already placed `location` at this entry.
        history.replaceState(target, "", appUrl(entryUrl(target)));
      });

      if (!applied) {
        // Blocked: popstate can't be cancelled, and the browser already moved
        // `location` to the popped entry. Re-push the entry we were just on so
        // the address bar and back stack look untouched until the user picks
        // "Keep editing" (stay, do nothing more) or "Discard changes" (the
        // deferred action above lands the target).
        const entry = currentRef.current;
        history.pushState(entry, "", appUrl(entryUrl(entry)));
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { view, selectedFile, setSelectedFile, selectedZone, selectedRunId, selectedTaskId, askSeed, navigateTo, handleSidebarNav };
}
