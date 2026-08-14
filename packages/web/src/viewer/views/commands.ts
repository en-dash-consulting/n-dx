/**
 * Commands view — trigger CLI operations from the dashboard.
 *
 * Provides action panels for: refresh data (live server), export static
 * dashboard, self-heal loop.
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName } from "../hooks/index.js";

// ── Types ────────────────────────────────────────────────────────────

type OpState = "idle" | "running" | "done" | "error";

// ── Export Panel ─────────────────────────────────────────────────────

function ExportPanel() {
  const cliName = useCliName();
  const [state, setState] = useState<OpState>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outDir, setOutDir] = useState("");
  const [pdfState, setPdfState] = useState<OpState>("idle");
  const [pdfOutput, setPdfOutput] = useState<string | null>(null);

  /**
   * Generate the sourcevision PDF report. Reports the written path: the viewer
   * sandbox blocks downloads the page initiates, so the path is the result.
   */
  const handleExportPdf = useCallback(async () => {
    setPdfState("running");
    setPdfOutput(null);
    try {
      const res = await fetch("/api/commands/export-pdf", { method: "POST" });
      const body = await res.json() as { ok?: boolean; error?: string; output?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPdfOutput(body.output ?? "PDF written.");
      setPdfState("done");
    } catch (err) {
      setPdfOutput(err instanceof Error ? err.message : String(err));
      setPdfState("error");
    }
  }, []);

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
        "Generate a static, deployable version of this dashboard. Equivalent to ", h("code", null, `${cliName} export`), "."
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
      h("button", {
        class: "cmd-btn cmd-btn-secondary",
        onClick: handleExportPdf,
        disabled: pdfState === "running",
        title: `Generate a PDF analysis report (${cliName} sourcevision export-pdf)`,
      }, pdfState === "running" ? "Generating PDF\u2026" : "Export PDF report"),
    ),

    pdfOutput
      ? h("pre", {
          class: `cmd-result-output${pdfState === "error" ? " cmd-inline-result-err" : ""}`,
          role: pdfState === "error" ? "alert" : "status",
        }, pdfOutput)
      : null,

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
  /** True when the run ended because an operator pressed Stop. */
  stopped?: boolean;
}

/**
 * Pull the newest iteration and phase markers out of the loop's output.
 *
 * `ndx self-heal` prints its progress as it goes; the status endpoint returns
 * the tail of that output, so the freshest matching lines describe where the
 * loop currently is.
 */
function parseSelfHealProgress(output: string): { iteration: string | null; phase: string | null } {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  let iteration: string | null = null;
  let phase: string | null = null;
  for (const line of lines) {
    const iter = /iteration\s+(\d+\s*(?:\/|of)\s*\d+)/i.exec(line);
    if (iter) iteration = `iteration ${iter[1].replace(/\s*of\s*/i, "/")}`;
    const ph = /\b(analyz\w*|recommend\w*|execut\w*)\b/i.exec(line);
    if (ph) phase = ph[1].toLowerCase();
  }
  return { iteration, phase };
}

export function SelfHealPanel() {
  const cliName = useCliName();
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
          // A stop the operator asked for is a normal outcome, not a failure.
          if (data.error && !data.stopped) {
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

  const handleStop = useCallback(async () => {
    try {
      const res = await fetch("/api/commands/self-heal/stop", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // The polling loop picks up running=false / stopped=true.
    } catch (err) {
      setError(String(err));
      setState("error");
    }
  }, []);

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
          "Equivalent to ", h("code", null, `${cliName} self-heal [N]`), "."
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
          (() => {
            const progress = statusData ? parseSelfHealProgress(statusData.output) : null;
            return progress && (progress.iteration || progress.phase)
              ? h("p", { class: "cmd-phase-item", role: "status", "aria-live": "polite" },
                  progress.iteration ?? "",
                  progress.iteration && progress.phase ? " \u00b7 " : "",
                  progress.phase ? `phase: ${progress.phase}` : "",
                )
              : null;
          })(),
          h("div", { class: "cmd-panel-actions" },
            h("button", {
              class: "cmd-btn cmd-btn-danger",
              onClick: handleStop,
              title: "Stop the loop after the current step",
            }, "Stop"),
          ),
          h("p", { class: "cmd-panel-hint" }, "Poll rate: 2 seconds. This may take several minutes."),
        )
      : null,

    state === "done"
      ? h("div", null,
          h("div", { class: "cmd-result-success", role: "status" },
            h("span", { class: "cmd-result-icon" }, statusData?.stopped ? "\u25A0" : "\u2713"),
            h("span", null, statusData?.stopped
              ? "Self-heal stopped by request."
              : "Self-heal complete."),
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

// ── Refresh Panel ────────────────────────────────────────────────────

interface RefreshStatusData {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  fast: boolean;
  phases: string[];
  output: string;
  error: string | null;
}

export function RefreshPanel() {
  const cliName = useCliName();
  const [state, setState] = useState<OpState>("idle");
  const [fast, setFast] = useState(false);
  const [statusData, setStatusData] = useState<RefreshStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll refresh status while running
  useEffect(() => {
    if (state !== "running") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/commands/refresh/status");
        if (!res.ok) return;
        const data = await res.json() as RefreshStatusData;
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
      const res = await fetch("/api/commands/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fast }),
      });

      const data = await res.json() as Record<string, unknown>;

      if (res.status === 409) {
        // Already running — the polling loop will pick up its status
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
  }, [fast]);

  return h("div", { class: "cmd-panel" },
    h("div", { class: "cmd-panel-header" },
      h("h3", { class: "cmd-panel-title" }, "\u{1F504} Refresh Data"),
      h("p", { class: "cmd-panel-desc" },
        "Re-run SourceVision analysis and regenerate dashboard data without restarting the server. Equivalent to ",
        h("code", null, `${cliName} refresh --data-only`), ".",
      ),
    ),

    h("div", { class: "cmd-panel-form" },
      h("label", { class: "cmd-panel-label cmd-panel-label-inline" },
        h("input", {
          type: "checkbox",
          checked: fast,
          onInput: (e: Event) => setFast((e.target as HTMLInputElement).checked),
          disabled: state === "running",
        }),
        " Fast mode (structural only — skip LLM enrichment)",
      ),
    ),

    h("div", { class: "cmd-panel-actions" },
      h("button", {
        class: "cmd-btn cmd-btn-primary",
        onClick: handleStart,
        disabled: state === "running",
      }, state === "running" ? "Refreshing..." : "Refresh Data"),
    ),

    state === "running"
      ? h("div", { class: "cmd-progress", role: "status", "aria-live": "polite" },
          h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
          h("span", null, "Refreshing SourceVision data..."),
        )
      : null,

    statusData && statusData.phases.length > 0
      ? h("ul", { class: "cmd-phase-list" },
          statusData.phases.map((phase, i) =>
            h("li", { key: i, class: "cmd-phase-item" }, phase)),
        )
      : null,

    state === "done"
      ? h("div", { class: "cmd-result cmd-result-ok", role: "status" },
          "Refresh complete — data views will update automatically.",
        )
      : null,

    state === "error" && error
      ? h("div", { class: "cmd-result cmd-result-error", role: "alert" }, error)
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
      h(RefreshPanel, null),
      h(ExportPanel, null),
      h(SelfHealPanel, null),
    ),
  );
}
