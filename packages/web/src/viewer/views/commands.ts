/**
 * Commands view — trigger CLI operations from the dashboard.
 *
 * Provides action panels for: export static dashboard, self-heal loop.
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

// ── Types ────────────────────────────────────────────────────────────

type OpState = "idle" | "running" | "done" | "error";

// ── Export Panel ─────────────────────────────────────────────────────

function ExportPanel() {
  const [state, setState] = useState<OpState>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outDir, setOutDir] = useState("");

  const handleExport = useCallback(async () => {
    setState("running");
    setError(null);
    setOutput(null);

    try {
      const res = await fetch("/api/commands/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outDir: outDir.trim() || undefined }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        throw new Error((data.error as string) || `HTTP ${res.status}`);
      }

      setOutput((data.output as string) || "Export complete.");
      setState("done");
    } catch (err) {
      setError(String(err));
      setState("error");
    }
  }, [outDir]);

  return h("div", { class: "cmd-panel" },
    h("div", { class: "cmd-panel-header" },
      h("h3", { class: "cmd-panel-title" }, "\u{1F4E4} Export Dashboard"),
      h("p", { class: "cmd-panel-desc" },
        "Generate a static, deployable version of this dashboard. Equivalent to ", h("code", null, "ndx export"), "."
      ),
    ),

    h("div", { class: "cmd-panel-form" },
      h("label", { class: "cmd-panel-label" }, "Output directory (optional)"),
      h("input", {
        type: "text",
        class: "cmd-panel-input",
        placeholder: "dist/dashboard",
        value: outDir,
        onInput: (e: Event) => setOutDir((e.target as HTMLInputElement).value),
        disabled: state === "running",
      }),
    ),

    h("div", { class: "cmd-panel-actions" },
      h("button", {
        class: "cmd-btn cmd-btn-primary",
        onClick: handleExport,
        disabled: state === "running",
      }, state === "running" ? "Exporting..." : "Export Dashboard"),
    ),

    state === "running"
      ? h("div", { class: "cmd-progress", role: "status", "aria-live": "polite" },
          h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
          h("span", null, "Generating static dashboard..."),
        )
      : null,

    state === "done" && output
      ? h("div", { class: "cmd-result-success", role: "status" },
          h("span", { class: "cmd-result-icon" }, "\u2713"),
          h("pre", { class: "cmd-result-output" }, output),
        )
      : null,

    error
      ? h("div", { class: "cmd-result-error", role: "alert" }, error)
      : null,
  );
}

// ── Self-Heal Panel ──────────────────────────────────────────────────

interface SelfHealStatusData {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  iterations: number;
  output: string;
  error: string | null;
}

function SelfHealPanel() {
  const [state, setState] = useState<OpState>("idle");
  const [confirmed, setConfirmed] = useState(false);
  const [iterations, setIterations] = useState(3);
  const [statusData, setStatusData] = useState<SelfHealStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll self-heal status when running
  useEffect(() => {
    if (state !== "running") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/commands/self-heal/status");
        if (!res.ok) return;
        const data = await res.json() as SelfHealStatusData;
        setStatusData(data);
        if (!data.running && data.finishedAt) {
          clearInterval(interval);
          if (data.error) {
            setError(data.error);
            setState("error");
          } else {
            setState("done");
          }
        }
      } catch {
        // Ignore transient fetch errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [state]);

  const handleStart = useCallback(async () => {
    setState("running");
    setError(null);
    setStatusData(null);

    try {
      const res = await fetch("/api/commands/self-heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iterations }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (res.status === 409) {
        // Already running — show status
        setState("running");
        return;
      }

      if (!res.ok) {
        throw new Error((data.error as string) || `HTTP ${res.status}`);
      }

      // 202 accepted — polling loop handles the rest
    } catch (err) {
      setError(String(err));
      setState("error");
    }
  }, [iterations]);

  const handleReset = useCallback(() => {
    setState("idle");
    setConfirmed(false);
    setError(null);
    setStatusData(null);
  }, []);

  if (!confirmed) {
    return h("div", { class: "cmd-panel" },
      h("div", { class: "cmd-panel-header" },
        h("h3", { class: "cmd-panel-title" }, "\u{1F9EC} Self-Heal"),
        h("p", { class: "cmd-panel-desc" },
          "Run an iterative improvement loop: analyze \u2192 recommend \u2192 execute. " +
          "This is a long-running operation that will make changes to your PRD. " +
          "Equivalent to ", h("code", null, "ndx self-heal [N]"), "."
        ),
      ),

      h("div", { class: "cmd-panel-warning" },
        h("span", { class: "cmd-panel-warning-icon" }, "\u26A0\uFE0F"),
        h("div", null,
          h("strong", null, "This operation modifies the PRD."),
          " Self-heal will analyze the codebase and autonomously execute tasks. " +
          "Do not run other write operations concurrently.",
        ),
      ),

      h("div", { class: "cmd-panel-form" },
        h("label", { class: "cmd-panel-label" }, "Iterations"),
        h("input", {
          type: "number",
          class: "cmd-panel-input cmd-panel-input-narrow",
          min: 1,
          max: 10,
          value: iterations,
          onInput: (e: Event) => setIterations(Math.max(1, Math.min(10, parseInt((e.target as HTMLInputElement).value, 10) || 3))),
        }),
        h("p", { class: "cmd-panel-hint" }, "1\u201310 iterations. Each iteration runs analyze + recommend + execute."),
      ),

      h("div", { class: "cmd-panel-actions" },
        h("button", {
          class: "cmd-btn cmd-btn-confirm",
          onClick: () => setConfirmed(true),
        }, "I understand \u2014 proceed"),
      ),
    );
  }

  return h("div", { class: "cmd-panel" },
    h("div", { class: "cmd-panel-header" },
      h("h3", { class: "cmd-panel-title" }, "\u{1F9EC} Self-Heal"),
    ),

    state === "idle"
      ? h(Fragment, null,
          h("p", { class: "cmd-panel-desc" },
            `Will run ${iterations} iteration${iterations !== 1 ? "s" : ""}.`,
          ),
          h("div", { class: "cmd-panel-actions" },
            h("button", {
              class: "cmd-btn cmd-btn-danger",
              onClick: handleStart,
            }, `Run Self-Heal (${iterations} iteration${iterations !== 1 ? "s" : ""})`),
            h("button", {
              class: "cmd-btn cmd-btn-secondary",
              onClick: handleReset,
            }, "Cancel"),
          ),
        )
      : null,

    state === "running"
      ? h("div", null,
          h("div", { class: "cmd-progress", role: "status", "aria-live": "polite" },
            h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
            h("span", null, "Self-heal running\u2026 (", iterations, " iterations)"),
          ),
          statusData?.startedAt
            ? h("p", { class: "cmd-panel-hint" },
                "Started: ", new Date(statusData.startedAt).toLocaleTimeString(),
              )
            : null,
          h("p", { class: "cmd-panel-hint" }, "Poll rate: 2 seconds. This may take several minutes."),
        )
      : null,

    state === "done"
      ? h("div", null,
          h("div", { class: "cmd-result-success", role: "status" },
            h("span", { class: "cmd-result-icon" }, "\u2713"),
            h("span", null, "Self-heal complete."),
          ),
          statusData?.output
            ? h("pre", { class: "cmd-result-output" }, statusData.output)
            : null,
          h("button", {
            class: "cmd-btn cmd-btn-secondary",
            onClick: handleReset,
            style: "margin-top: 12px",
          }, "Reset"),
        )
      : null,

    state === "error"
      ? h("div", null,
          h("div", { class: "cmd-result-error", role: "alert" },
            h("strong", null, "Self-heal failed:"),
            " ",
            error || statusData?.error || "Unknown error",
          ),
          h("button", {
            class: "cmd-btn cmd-btn-secondary",
            onClick: handleReset,
            style: "margin-top: 12px",
          }, "Reset"),
        )
      : null,
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function CommandsView() {
  return h("div", { class: "commands-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Commands"),
    ),
    h("p", { class: "section-sub" },
      "Trigger CLI operations directly from the dashboard.",
    ),

    h("div", { class: "cmd-panels" },
      h(ExportPanel, null),
      h(SelfHealPanel, null),
    ),
  );
}
