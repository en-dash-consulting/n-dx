/**
 * Start a SourceVision analysis and follow it to completion.
 *
 * The dashboard has exactly one way to run an analysis — `POST
 * /api/commands/sv-analyze`, then poll `/api/commands/sv-analyze/status` until
 * it stops running. This hook is that flow, extracted from `EnrichmentGate` so
 * a second surface can offer the same action instead of growing its own copy
 * that drifts on what "already running" or "finished with an error" means.
 *
 * The 409 case is the subtle one: a concurrent analysis is not a failure, it is
 * the thing the caller wanted already happening, so the poll takes over rather
 * than reporting an error.
 *
 * @module web/viewer/hooks/use-sv-analyze
 * @see packages/web/src/viewer/components/enrichment-gate.ts
 * @see packages/web/src/viewer/views/ask.ts
 */

import { useState, useCallback, useEffect } from "preact/hooks";

/** Status payload from `/api/commands/sv-analyze/status`. */
interface SvAnalyzeStatusData {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  recentOutput: string;
  error: string | null;
}

/** What to run: a target enrichment pass, or every pass. */
export interface SvAnalyzeRequest {
  full?: boolean;
  targetPass?: number;
}

export interface SvAnalyzeController {
  state: "idle" | "running" | "done" | "error";
  /** Last line of analysis output while running, when there is one. */
  progress: string | null;
  /** Why it failed, when it did. */
  error: string | null;
  /** True while an analysis is in flight. */
  busy: boolean;
  start: (body: SvAnalyzeRequest) => Promise<void>;
}

export function useSvAnalyze(pollIntervalMs = 3000): SvAnalyzeController {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "running") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/commands/sv-analyze/status");
        if (!res.ok) return;
        const data = await res.json() as SvAnalyzeStatusData;
        const lastLine = data.recentOutput.split("\n").filter(Boolean).pop();
        if (lastLine) setProgress(lastLine.slice(0, 120));
        if (!data.running && data.finishedAt) {
          clearInterval(interval);
          if (data.error) {
            setError(data.error);
            setState("error");
          } else {
            setProgress(null);
            setState("done");
          }
        }
      } catch {
        // Ignore transient fetch errors — the next tick tries again.
      }
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [state, pollIntervalMs]);

  const start = useCallback(async (body: SvAnalyzeRequest) => {
    setState("running");
    setError(null);
    setProgress(null);
    try {
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        // Already running — the polling loop above will track it.
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Analysis failed to start" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      // 202 accepted — the polling loop handles the rest.
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setState("error");
    }
  }, []);

  return { state, progress, error, busy: state === "running", start };
}
