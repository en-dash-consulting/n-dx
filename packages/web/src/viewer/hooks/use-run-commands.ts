/**
 * The project's detected run/build commands, and the one currently running.
 *
 * The command list is read once on mount — a project does not grow a `dev`
 * script while you are looking at it — while the running job is polled only
 * while something is actually running, so an idle dashboard makes no repeat
 * requests for it.
 */
import { useState, useCallback, useEffect, useRef } from "preact/hooks";

export interface DetectedCommand {
  id: string;
  label: string;
  kind: "run" | "build";
  bin: string;
  args: string[];
  source: string;
}

export interface RunCommandStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  commandId: string | null;
  label: string | null;
  kind: "run" | "build" | null;
  output: string;
  exitCode: number | null;
  error: string | null;
  stopped: boolean;
  url: string | null;
}

export interface RunCommandsState {
  commands: DetectedCommand[];
  status: RunCommandStatus | null;
  /** Rejection text from the last start/stop attempt, if any. */
  error: string | null;
  start: (id: string) => Promise<void>;
  stop: () => Promise<void>;
}

/** How often a running job is re-read. Fast enough to feel live. */
const POLL_MS = 1_500;

export function useRunCommands(enabled = true): RunCommandsState {
  const [commands, setCommands] = useState<DetectedCommand[]>([]);
  const [status, setStatus] = useState<RunCommandStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/run-commands/status");
      if (!res.ok) return;
      const next = (await res.json()) as RunCommandStatus;
      if (mounted.current) setStatus(next);
    } catch {
      // Keeps the last known status; the next tick tries again.
    }
  }, []);

  // Initial load: the command list and whatever is already running, since a
  // job survives a page reload.
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const res = await fetch("/api/run-commands");
        if (!res.ok) return;
        const body = (await res.json()) as { commands: DetectedCommand[]; status: RunCommandStatus };
        if (!mounted.current) return;
        setCommands(body.commands ?? []);
        setStatus(body.status ?? null);
      } catch {
        // A project with no detectable commands and an unreachable endpoint
        // look the same from here: the control simply does not appear.
      }
    })();
  }, [enabled]);

  // Poll only while something is running.
  useEffect(() => {
    if (!enabled || !status?.running) return;
    const timer = setInterval(() => { void refreshStatus(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, status?.running, refreshStatus]);

  const start = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch("/api/run-commands/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      await refreshStatus();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshStatus]);

  const stop = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/run-commands/stop", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      await refreshStatus();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshStatus]);

  return { commands, status, error, start, stop };
}
