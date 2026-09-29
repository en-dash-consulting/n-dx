/**
 * Quick and full analysis triggers for the SourceVision surface.
 *
 * Quick re-analyze is a synchronous structural refresh. Full analysis runs all
 * four enrichment passes (unlocking the Architecture, Problems, and Suggestions
 * tabs) as a background job, because the LLM passes can take many minutes.
 * Tab data repopulates automatically via the viewer's data polling once new
 * files land.
 *
 * The full run's progress is *not* tracked here. It is a shared job like any
 * other: this component starts it and then reads its state from the job tray
 * (`jobs`), which shows phase, elapsed time and Stop from whichever view the
 * user is on. Only the synchronous quick path keeps local state, because it
 * has no tray presence to have — it is over before the request returns.
 *
 * Lifted out of `views/overview.ts` when the Ask panel needed the same
 * affordance: a panel that cannot answer because there is no analysis should
 * offer the run rather than name the command and leave the user to find it.
 * Two consumers, so it clears the two-consumer rule for `components/`.
 *
 * @module web/viewer/components/analyze-controls
 * @see enrichment-gate.ts — the pass-gated sibling, which drives the same endpoint
 */

import { h } from "preact";
import { useState, useCallback } from "preact/hooks";
import { findOperation } from "../hooks/index.js";
import type { JobTray } from "../hooks/index.js";

export interface AnalyzeControlsProps {
  jobs: JobTray;
}

export function AnalyzeControls({ jobs }: AnalyzeControlsProps) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);

  const fullOp = findOperation(jobs.operations, "sv-analyze");
  const fullRunning = fullOp?.status === "running";

  const handleQuick = useCallback(async () => {
    setState("running");
    setError(null);
    try {
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deep }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Analysis failed" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      setState("done");
      setTimeout(() => setState("idle"), 4000);
    } catch (err) {
      setError(String(err));
      setState("error");
      setTimeout(() => setState("idle"), 6000);
    }
  }, [deep]);

  const handleFull = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full: true, deep }),
      });
      // 409 means one is already running — the tray reports that one.
      if (!res.ok && res.status !== 409) {
        const d = await res.json().catch(() => ({ error: "Full analysis failed to start" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
      setState("error");
      setTimeout(() => setState("idle"), 10000);
    }
    // Show the run in the tray now rather than at the next poll tick.
    await jobs.refresh();
  }, [deep, jobs]);

  const busy = state === "running" || fullRunning;

  return h("div", { class: "overview-reanalyze cmd-panel-actions" },
    h("label", {
      class: "overview-deep-toggle",
      title: "Re-analyze detected sub-packages before the root analysis (sourcevision analyze --deep). Slower; useful for monorepos.",
    },
      h("input", {
        type: "checkbox",
        checked: deep,
        disabled: busy,
        onChange: (e: Event) => setDeep((e.target as HTMLInputElement).checked),
      }),
      " Deep (sub-packages)",
    ),
    h("button", {
      class: "cmd-btn cmd-btn-primary",
      onClick: handleQuick,
      disabled: busy,
      "aria-busy": state === "running",
      title: "Re-run sourcevision analyze to refresh all data",
    },
      state === "running"
        ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
        : h("span", { "aria-hidden": "true" }, "\u{1F504}"),
      state === "running" ? "Analyzing..." : "Re-analyze",
    ),
    h("button", {
      class: "cmd-btn cmd-btn-secondary",
      onClick: handleFull,
      disabled: busy,
      "aria-busy": fullRunning,
      title: "Run all four enrichment passes — unlocks the Architecture, Problems, and Suggestions tabs. Takes several minutes.",
    },
      fullRunning
        ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
        : h("span", { "aria-hidden": "true" }, "✨"),
      fullRunning ? "Running full analysis..." : "Full analysis",
    ),
    h("span", { role: "status", "aria-live": "polite" },
      fullRunning && fullOp?.detail
        ? h("span", { class: "cmd-inline-progress" }, fullOp.detail.slice(0, 120))
        : null,
      state === "done"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" }, "✓ Done")
        : null,
      !fullRunning && fullOp?.status === "done" && !fullOp.stopped
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" },
            "✓ Full analysis complete — tabs unlock as data refreshes")
        : null,
    ),
    state === "error" && error
      ? h("span", { class: "cmd-inline-result cmd-inline-result-err", role: "alert" }, error)
      : null,
  );
}
