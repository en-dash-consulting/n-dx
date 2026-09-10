/**
 * Quick and full analysis triggers for the SourceVision surface.
 *
 * Quick re-analyze is a synchronous structural refresh. Full analysis runs all
 * four enrichment passes (unlocking the Architecture, Problems, and Suggestions
 * tabs) as a background job — 202 + status polling — because the LLM passes can
 * take many minutes. Tab data repopulates automatically via the viewer's data
 * polling once new files land.
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
import { useState, useCallback, useEffect } from "preact/hooks";

interface SvAnalyzeStatusData {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  recentOutput: string;
  error: string | null;
}

export function AnalyzeControls() {
  const [state, setState] = useState<"idle" | "running" | "running-full" | "done" | "done-full" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);

  // Poll full-analysis status while running
  useEffect(() => {
    if (state !== "running-full") return;

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
            setTimeout(() => setState("idle"), 10000);
          } else {
            setProgress(null);
            setState("done-full");
            setTimeout(() => setState("idle"), 8000);
          }
        }
      } catch {
        // Ignore transient fetch errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [state]);

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
    setState("running-full");
    setError(null);
    setProgress(null);
    try {
      const res = await fetch("/api/commands/sv-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full: true, deep }),
      });
      if (res.status === 409) {
        // Already running — the polling loop will track it
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Full analysis failed to start" })) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      // 202 accepted — polling loop handles the rest
    } catch (err) {
      setError(String(err));
      setState("error");
      setTimeout(() => setState("idle"), 10000);
    }
  }, [deep]);

  const busy = state === "running" || state === "running-full";

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
      "aria-busy": state === "running-full",
      title: "Run all four enrichment passes — unlocks the Architecture, Problems, and Suggestions tabs. Takes several minutes.",
    },
      state === "running-full"
        ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
        : h("span", { "aria-hidden": "true" }, "✨"),
      state === "running-full" ? "Running full analysis..." : "Full analysis",
    ),
    h("span", { role: "status", "aria-live": "polite" },
      state === "running-full" && progress
        ? h("span", { class: "cmd-inline-progress" }, progress)
        : null,
      state === "done"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" }, "✓ Done")
        : null,
      state === "done-full"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" },
            "✓ Full analysis complete — tabs unlock as data refreshes")
        : null,
    ),
    state === "error" && error
      ? h("span", { class: "cmd-inline-result cmd-inline-result-err", role: "alert" }, error)
      : null,
  );
}
