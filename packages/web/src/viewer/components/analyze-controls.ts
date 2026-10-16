/**
 * The analyze control for the SourceVision surface: one split button.
 *
 * The main part re-runs the quick, synchronous structural analysis. The caret
 * opens a small menu with the full analysis — all four enrichment passes,
 * unlocking Architecture, Problems and Suggestions, run as a background job
 * because the LLM passes take minutes — and the "Include sub-packages" switch
 * (`sourcevision analyze --deep`), which applies to either run.
 *
 * The full run's progress is *not* tracked here. It is a shared job like any
 * other: this component starts it and then reads its state from the job tray
 * (`jobs`), which shows phase, elapsed time and Stop from whichever view the
 * user is on. Only the synchronous quick path keeps local state, because it
 * has no tray presence to have — it is over before the request returns.
 *
 * Two consumers (the Analysis page head and the Ask panel's empty state), so
 * it clears the two-consumer rule for `components/`.
 *
 * @module web/viewer/components/analyze-controls
 * @see enrichment-gate.ts — the pass-gated sibling, which drives the same endpoint
 */

import { h } from "preact";
import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { findOperation } from "../hooks/index.js";
import type { JobTray } from "../hooks/index.js";
import { ActionIcon } from "./action-icon.js";

export interface AnalyzeControlsProps {
  jobs: JobTray;
}

export function AnalyzeControls({ jobs }: AnalyzeControlsProps) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  const fullOp = findOperation(jobs.operations, "sv-analyze");
  const fullRunning = fullOp?.status === "running";

  // The menu closes on Escape (returning focus to the caret) and on any click
  // outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenuOpen(false); caretRef.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuOpen]);

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
    setMenuOpen(false);
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
  const label = state === "running" ? "Analyzing…" : fullRunning ? "Full analysis running…" : "Re-analyze";

  const status = fullRunning && fullOp?.detail
    ? h("span", { class: "analyze-status" }, fullOp.detail.slice(0, 120))
    : state === "done"
      ? h("span", { class: "analyze-status analyze-status--ok" }, "Analysis refreshed")
      : !fullRunning && fullOp?.status === "done" && !fullOp.stopped
        ? h("span", { class: "analyze-status analyze-status--ok" }, "Full analysis complete")
        : null;

  return h("div", { class: "analyze-control", ref: rootRef },
    h("div", { class: "analyze-split" },
      h("button", {
        type: "button",
        class: "analyze-main",
        onClick: handleQuick,
        disabled: busy,
        "aria-busy": busy,
        title: deep
          ? "Re-run the structural analysis, sub-packages first"
          : "Re-run the structural analysis: inventory, imports, zones",
      },
        busy
          ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
          : h(ActionIcon, { name: "refresh" }),
        label,
      ),
      h("button", {
        ref: caretRef,
        type: "button",
        class: "analyze-caret",
        onClick: () => setMenuOpen((v) => !v),
        disabled: busy,
        "aria-haspopup": "menu",
        "aria-expanded": String(menuOpen),
        "aria-label": "More analysis options",
      }, h(ActionIcon, { name: "chevron-down" })),
    ),
    menuOpen
      ? h("div", { class: "analyze-menu", role: "menu", "aria-label": "Analysis options" },
          h("button", { type: "button", role: "menuitem", class: "analyze-menu-item", onClick: handleFull },
            h("span", { class: "analyze-menu-title" }, "Full analysis"),
            h("span", { class: "analyze-menu-desc" }, "All four enrichment passes — unlocks Architecture, Problems and Suggestions. Takes several minutes."),
          ),
          h("div", { class: "analyze-menu-sep", role: "separator" }),
          h("button", {
            type: "button",
            role: "menuitemcheckbox",
            "aria-checked": String(deep),
            class: "analyze-menu-item analyze-menu-toggle",
            onClick: () => setDeep((v) => !v),
          },
            h("span", { class: "analyze-menu-text" },
              h("span", { class: "analyze-menu-title" }, "Include sub-packages"),
              h("span", { class: "analyze-menu-desc" }, "Analyze detected sub-packages first. Slower; for monorepos."),
            ),
            h("span", { class: `analyze-switch${deep ? " analyze-switch--on" : ""}`, "aria-hidden": "true" }),
          ),
        )
      : null,
    h("span", { role: "status", "aria-live": "polite", class: "analyze-status-slot" }, status),
    state === "error" && error
      ? h("span", { class: "analyze-status analyze-status--err", role: "alert" }, error)
      : null,
  );
}
