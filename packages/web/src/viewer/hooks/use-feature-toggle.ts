/**
 * Hook to subscribe to a specific feature toggle value from the API.
 *
 * Fetches the toggle state once on mount and re-fetches whenever the
 * feature-toggles view saves a change (listens for the custom
 * `feature-toggle-changed` event on `window`).
 *
 * @see ../views/feature-toggles.ts — emits `feature-toggle-changed`
 * @see ../../server/routes-features.ts — GET /api/features
 */

import { useState, useEffect, useCallback, useRef } from "preact/hooks";

/**
 * Subscribe to a single feature toggle by key.
 *
 * @param key - Fully-qualified toggle key (e.g. `"rex.showTokenBudget"`).
 * @param defaultValue - Value to use until the first fetch completes (and on error).
 * @returns Current toggle value (updates reactively when changed via the UI).
 */
export function useFeatureToggle(key: string, defaultValue: boolean): boolean {
  const [enabled, setEnabled] = useState(defaultValue);
  const mountedRef = useRef(true);

  const fetchToggle = useCallback(async () => {
    try {
      const res = await fetch("/api/features");
      if (!res.ok) return;
      const json = (await res.json()) as {
        toggles?: Array<{ key: string; enabled: boolean }>;
      };
      if (!mountedRef.current) return;
      const toggle = json.toggles?.find((t) => t.key === key);
      if (toggle !== undefined) {
        setEnabled(toggle.enabled);
      }
    } catch {
      // Keep current value on network errors.
    }
  }, [key]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchToggle();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchToggle]);

  // Re-fetch on toggle change events from the feature-toggles UI
  useEffect(() => {
    const handler = () => {
      fetchToggle();
    };
    window.addEventListener("feature-toggle-changed", handler);
    return () => window.removeEventListener("feature-toggle-changed", handler);
  }, [fetchToggle]);

  return enabled;
}
