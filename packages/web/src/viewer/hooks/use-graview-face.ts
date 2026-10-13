/**
 * The product map's state, from `GET /api/graview/face` (routes-graview.ts):
 * the running Graview face's URL, whether `features.graview.productFace` is
 * on, and how the server's own launch is going. Polled, since a face started
 * by hand (`ndx graview serve .`) appears without the dashboard's help.
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { registerPoller } from "../polling/index.js";

export interface GraviewFaceState {
  face: { url: string } | null;
  enabled: boolean;
  starting: boolean;
  error: string | null;
}

const POLL_MS = 15_000;
/** Faster while a launch is coming up: an emit and a Vite start take seconds. */
const STARTING_POLL_MS = 2_000;

async function fetchFace(): Promise<GraviewFaceState | null> {
  try {
    const res = await fetch("/api/graview/face");
    if (!res.ok) return null;
    return (await res.json()) as GraviewFaceState;
  } catch {
    return null;
  }
}

export function useGraviewFace(enabled = true): { state: GraviewFaceState | null; start: () => Promise<void> } {
  const [state, setState] = useState<GraviewFaceState | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      void fetchFace().then((next) => {
        if (alive && next) setState(next);
      });
    };
    load();
    const unregister = registerPoller("graview-face", load, state?.starting ? STARTING_POLL_MS : POLL_MS);
    return () => {
      alive = false;
      unregister();
    };
  }, [enabled, state?.starting]);

  const start = useCallback(async () => {
    try {
      const res = await fetch("/api/graview/face", { method: "POST" });
      const body = (await res.json()) as GraviewFaceState | { error?: string };
      if (res.ok) setState(body as GraviewFaceState);
      else setState((prev) => ({ face: null, enabled: prev?.enabled ?? false, starting: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` }));
    } catch (err) {
      setState((prev) => ({ face: null, enabled: prev?.enabled ?? false, starting: false, error: (err as Error).message }));
    }
  }, []);

  return { state, start };
}
