/**
 * App data management hook for the viewer.
 *
 * Handles mode detection (server vs static file drop), data loading,
 * polling, drag-and-drop file loading, and the refresh toast notification.
 */

import { useState, useEffect, useRef } from "preact/hooks";
import type { LoadedData } from "../types.js";
import {
  loadFromServer,
  loadFromFiles,
  detectMode,
  onDataChange,
  clearOnChange,
  startPolling,
  stopPolling,
} from "../loader.js";

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

export function useAppData(): AppDataState {
  const [data, setData] = useState<LoadedData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"server" | "static">("static");
  const [refreshToast, setRefreshToast] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const initialLoad = useRef(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        await loadFromServer();
        setLoading(false);
        initialLoad.current = false;
        startPolling(5000);
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
