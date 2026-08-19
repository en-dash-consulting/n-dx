/**
 * EnrichmentGate — the page shown for pass-gated SourceVision views
 * (Architecture P2, Problems P3, Suggestions P4) before their enrichment
 * pass has run.
 *
 * Instead of a dead-end "run the CLI" hint, the gate offers two actions:
 * - Run enrichment up to just the pass this view needs (`targetPass`)
 * - Run the full analysis (all passes, unlocking every gated view)
 *
 * Both go through POST /api/commands/sv-analyze, which runs them as an
 * async singleton (202 + status polling). When the run finishes, the
 * viewer's data polling picks up the new zones.json and the host view
 * re-renders unlocked — the gate itself never needs to navigate.
 */

import { h } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";

interface SvAnalyzeStatusData {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  recentOutput: string;
  error: string | null;
}

export interface EnrichmentGateProps {
  /** View name shown as the heading, e.g. "Architecture". */
  title: string;
  /** Enrichment pass this view needs (2–4). */
  requiredPass: number;
  /** Current enrichment pass from zones.json (0 when unanalyzed). */
  currentPass: number;
  /** Status poll interval in ms (overridable for tests). Default 3000. */
  pollIntervalMs?: number;
}

export function EnrichmentGate({ title, requiredPass, currentPass, pollIntervalMs = 3000 }: EnrichmentGateProps) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // Poll analysis status while running (mirrors AnalyzeControls on Overview)
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
        // Ignore transient fetch errors
      }
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [state, pollIntervalMs]);

  const start = useCallback(async (body: { full?: boolean; targetPass?: number }) => {
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
        // Already running — the polling loop will track it
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Analysis failed to start" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      // 202 accepted — polling loop handles the rest
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setState("error");
    }
  }, []);

  const busy = state === "running";

  return h("div", { class: "locked-view enrichment-gate" },
    h("div", { class: "locked-icon", "aria-hidden": "true" }, "\u{1F512}"),
    h("h2", null, title),
    h("p", null, "Requires enrichment pass ", requiredPass, " (current: ", currentPass, ")"),
    h("p", { class: "locked-hint" },
      "Each analysis run adds one enrichment pass. Unlock just this view, or run the full analysis to unlock every tab.",
    ),
    h("div", { class: "locked-actions cmd-panel-actions" },
      h("button", {
        class: "cmd-btn cmd-btn-primary enrichment-gate-unlock",
        onClick: () => start({ targetPass: requiredPass }),
        disabled: busy,
        "aria-busy": busy,
        title: `Run enrichment passes up to pass ${requiredPass} — just enough to unlock ${title}`,
        type: "button",
      }, busy ? "Running..." : `Unlock ${title} (to pass ${requiredPass})`),
      h("button", {
        class: "cmd-btn cmd-btn-secondary enrichment-gate-full",
        onClick: () => start({ full: true }),
        disabled: busy,
        title: "Run all enrichment passes — unlocks Architecture, Problems, and Suggestions. Takes several minutes.",
        type: "button",
      }, "Run full analysis (all passes)"),
    ),
    h("p", { role: "status", "aria-live": "polite" },
      busy
        ? h("span", { class: "enrichment-gate-progress" },
            h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" }),
            " ",
            progress ?? "Analysis running — this can take several minutes...",
          )
        : null,
      state === "done"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" },
            "✓ Analysis complete — this view unlocks as data refreshes",
          )
        : null,
    ),
    state === "error" && error
      ? h("p", { class: "cmd-inline-result cmd-inline-result-err", role: "alert" }, error)
      : null,
  );
}
