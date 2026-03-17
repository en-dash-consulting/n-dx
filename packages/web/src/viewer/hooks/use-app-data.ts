/**
 * App data management hook for the viewer.
 *
 * Handles mode detection (server vs static file drop), data loading,
 * polling, drag-and-drop file loading, and the refresh toast notification.
 *
 * Memory-efficient loading strategy:
 * 1. Load manifest + zones first (small, needed for sidebar/shell)
 * 2. Load remaining modules in the background without blocking the UI
 * 3. Polling uses selective refresh — only reloads files whose mtime changed
 *
 * Polling is automatically suspended when memory pressure disables the
 * `autoRefresh` feature (elevated tier, ≥50% heap usage). The hook
 * subscribes to degradation changes internally so the suspension is
 * self-contained — callers do not need to pass `pausePolling` for
 * memory-pressure protection.
 */

import { useState, useEffect, useRef } from "preact/hooks";
import type { LoadedData } from "../types.js";
import {
  loadModules,
  loadFromFiles,
  detectMode,
  onDataChange,
  clearOnChange,
  startPolling,
  stopPolling,
} from "../loader.js";
import { isFeatureDisabled, onDegradationChange } from "../performance/index.js";
import { isDeployedMode } from "../deployed-mode.js";

export interface AppDataState {
  data: LoadedData;
  loading: boolean;
  mode: "server" | "static";
  refreshToast: boolean;
  showDrop: boolean;
  setLoading: (loading: boolean) => void;
}

const EMPTY_DATA: LoadedData = {
  manifest: null,
  inventory: null,
  imports: null,
  zones: null,
  components: null,
  callGraph: null,
};

/** Modules needed for the initial UI shell (sidebar, overview). */
const PRIORITY_MODULES: Array<keyof LoadedData> = ["manifest", "zones"];

/** Remaining modules loaded in background after shell renders. */
const DEFERRED_MODULES: Array<keyof LoadedData> = [
  "inventory", "imports", "components", "callGraph",
];

export interface UseAppDataOptions {
  /** When true, data polling is paused to conserve memory (graceful degradation). */
  pausePolling?: boolean;
}

export function useAppData(options: UseAppDataOptions = {}): AppDataState {
  const { pausePolling = false } = options;
  const [data, setData] = useState<LoadedData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"server" | "static">("static");
  const [refreshToast, setRefreshToast] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const initialLoad = useRef(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track memory-pressure state reactively so the polling effect
  // responds to degradation tier changes (mirrors status-indicators pattern).
  const [autoRefreshDisabled, setAutoRefreshDisabled] = useState(
    () => isFeatureDisabled("autoRefresh")
  );

  useEffect(() => {
    const unsubscribe = onDegradationChange((state) => {
      setAutoRefreshDisabled(state.disabledFeatures.has("autoRefresh"));
    });
    return unsubscribe;
  }, []);

  // Data change listener + mode detection
  useEffect(() => {
    onDataChange((newData) => {
      setData(newData);
      if (!initialLoad.current) {
        setRefreshToast(true);
        // Clear any pending toast dismiss timer before setting a new one
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setRefreshToast(false);
          toastTimerRef.current = null;
        }, 3000);
      }
    });

    detectMode().then(async (m) => {
      setMode(m);
      if (m === "server") {
        // Staged loading: load critical modules first for fast shell render,
        // then load the rest in the background without blocking the UI.
        await loadModules(PRIORITY_MODULES);
        setLoading(false);
        initialLoad.current = false;
        // In deployed mode, data is static — polling would be wasteful.
        if (!isDeployedMode()) {
          startPolling(5000);
        }

        // Load remaining modules in the background (non-blocking).
        // Uses requestIdleCallback where available to avoid blocking the main
        // thread; falls back to setTimeout for environments without it.
        const scheduleDeferred = typeof requestIdleCallback === "function"
          ? requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 50);
        scheduleDeferred(() => {
          loadModules(DEFERRED_MODULES);
        });
      } else {
        setLoading(false);
        setShowDrop(true);
      }
    });

    return () => {
      stopPolling();
      clearOnChange();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // Pause or resume polling in response to degradation signals.
  // Combines the external pausePolling prop with the internal
  // autoRefreshDisabled state so that either source can suspend polling.
  const shouldPause = pausePolling || autoRefreshDisabled;

  useEffect(() => {
    if (mode !== "server") return;
    if (shouldPause) {
      stopPolling();
    } else if (!initialLoad.current) {
      // Only resume if we've already completed the initial load.
      startPolling(5000);
    }
  }, [shouldPause, mode]);

  // Drag-and-drop (only active in static mode)
  useEffect(() => {
    if (mode === "server") return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(true);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(false);
      if (e.dataTransfer?.files) {
        setLoading(true);
        await loadFromFiles(e.dataTransfer.files);
        setLoading(false);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setShowDrop(false);
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragleave", handleDragLeave);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragleave", handleDragLeave);
    };
  }, [mode]);

  return { data, loading, mode, refreshToast, showDrop, setLoading };
}
