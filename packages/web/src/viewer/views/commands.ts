/**
 * Commands view — trigger CLI operations from the dashboard.
 *
 * Provides action panels for: refresh data (live server), export static
 * dashboard, self-heal loop.
 *
 * The two long-running panels (self-heal, refresh) do not track their own
 * runs. They start a job, then read its state from the shared job tray
 * (`jobs`, passed down from main.ts) — which is what shows progress, elapsed
 * time and Stop, from any view rather than only this one. Each panel fetches
 * the status endpoint exactly once, when its run ends, for the full log the
 * tray row has no room for.
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName, findOperation } from "../hooks/index.js";
import type { ActiveOperation, JobTray } from "../hooks/index.js";

// ── Types ────────────────────────────────────────────────────────────

type OpState = "idle" | "running" | "done" | "error";

/**
 * Fetch a finished job's full status once, when it finishes.
 *
 * Keyed on `finishedAt` so it fires on each completed run and never while one
 * is in flight — the tray already carries the in-flight detail, and a second
 * watcher on the same endpoint is the per-view poller this view just lost.
 * `null` until a run has completed with the panel mounted.
 */
function useFinishedStatus<T>(op: ActiveOperation | undefined, url: string): [T | null, () => void] {
  const [status, setStatus] = useState<T | null>(null);
  const finishedAt = op?.finishedAt ?? null;

  useEffect(() => {
    if (!finishedAt) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json() as T;
        if (!cancelled) setStatus(data);
      } catch {
        // The tray row still reports the outcome.
      }
    })();
    return () => { cancelled = true; };
  }, [finishedAt, url]);

  return [status, useCallback(() => setStatus(null), [])];
}

// ── Sample App Panel ───────────────────────────────────────────────────

function InstallSamplePanel() {
  const cliName = useCliName();
  const [state, setState] = useState<OpState>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepMessage, setStepMessage] = useState<string>("");
  const [activeAction, setActiveAction] = useState<"install" | "destroy" | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/commands/sample-status");
      const data = await res.json() as { isInstalled: boolean };
      if (res.ok) {
        setIsInstalled(data.isInstalled);
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleAction = useCallback(async (action: "install" | "destroy") => {
    setState("running");
    setActiveAction(action);
    setError(null);
    setOutput(null);

    // Progressive UI feedback steps
    const steps = action === "install"
      ? ["Initializing sandbox...", "Creating webapp files...", "Generating sample PRD trees...", "Finalizing setup..."]
      : ["Cleaning up source files...", "Pruning PRD trees...", "Removing sandbox environment..."];

    let stepIndex = 0;
    setStepMessage(steps[0]);

    const stepInterval = setInterval(() => {
      stepIndex++;
      if (stepIndex < steps.length) {
        setStepMessage(steps[stepIndex]);
      }
    }, 600); // 600ms per step to make the loading indicator noticeable

    try {
      // Intentionally slowing down the fetch slightly to let the animation play out
      const [res] = await Promise.all([
        fetch(`/api/commands/${action}-sample`, { method: "POST" }),
        new Promise(resolve => setTimeout(resolve, steps.length * 600))
      ]);

      clearInterval(stepInterval);
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        throw new Error((data.error as string) || `HTTP ${res.status}`);
      }

      setOutput((data.output as string) || `${action === "install" ? "Install" : "Destroy"} complete.`);
      setState("done");
      fetchStatus();
    } catch (err) {
      clearInterval(stepInterval);
      setError(String(err));
      setState("error");
    } finally {
      setActiveAction(null);
    }
  }, [fetchStatus]);

  return h("div", { class: "cmd-panel" },
    h("div", { class: "cmd-panel-header" },
      h("h3", { class: "cmd-panel-title" }, "✨ Sample App"),
      h("p", { class: "cmd-panel-desc" },
        "Install a safe, easily destroyable sample web application to quickly explore and understand how n-dx manages PRDs and codebase analysis."
      ),
      isInstalled !== null
        ? h("div", { 
            style: `display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; font-size: 0.85em; font-weight: 500; margin-top: 12px; background: ${isInstalled ? "var(--color-bg-success)" : "var(--color-bg-subtle)"}; color: ${isInstalled ? "var(--color-text-success)" : "var(--color-text-muted)"}; border: 1px solid ${isInstalled ? "var(--color-border-success)" : "var(--color-border)"}` 
          },
            h("span", { style: "font-size: 1.2em;" }, isInstalled ? "✓" : "○"),
            isInstalled ? "Sample App is installed" : "Sample App is not installed"
          )
        : null
    ),

    h("div", { class: "cmd-panel-actions" },
      h("button", {
        class: "cmd-btn cmd-btn-primary",
        onClick: () => handleAction("install"),
        disabled: state === "running" || isInstalled === true,
      }, state === "running" && activeAction === "install" ? "Installing..." : "Install Sample App"),
      h("button", {
        class: "cmd-btn cmd-btn-danger",
        onClick: () => handleAction("destroy"),
        disabled: state === "running" || isInstalled === false,
        style: "margin-left: 12px",
      }, state === "running" && activeAction === "destroy" ? "Destroying..." : "Destroy Sample App"),
    ),

    isInstalled === true && h("div", { 
      style: "margin-top: 16px; padding: 14px; background: var(--color-bg-subtle); border-radius: 8px; border: 1px solid var(--color-border); font-size: 0.9em;"
    },
      h("h4", { style: "margin: 0 0 8px 0; color: var(--color-text); font-size: 1.05em; display: flex; align-items: center; gap: 6px;" }, "🚀 Next Steps"),
      h("p", { style: "margin: 0 0 12px 0; color: var(--color-text-muted);" }, "The sample app has been generated in a new `sample-app/` directory along with a dummy PRD! Open your terminal and run the following commands to see n-dx in action:"),
      h("pre", { style: "margin: 0; padding: 10px; background: var(--color-bg-code); border-radius: 6px; color: var(--color-text-code); font-family: monospace; white-space: pre-wrap; font-size: 0.95em;" },
        `${cliName} status\n` +
        `${cliName} work --auto`
      )
    ),

    state === "running"
      ? h("div", { class: "cmd-progress", role: "status", "aria-live": "polite" },
          h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
          h("div", { style: "display: flex; flex-direction: column; gap: 4px;" },
            h("span", { style: "font-weight: 500;" }, stepMessage),
            h("span", { style: "font-size: 0.85em; opacity: 0.7;" }, "Please wait, this will only take a moment...")
          )
        )
      : null,

    state === "done" && output
      ? h("div", { class: "cmd-result-success", role: "status", style: "animation: fadeIn 0.3s ease-in;" },
          h("span", { class: "cmd-result-icon" }, "✓"),
          h("pre", { class: "cmd-result-output" }, output),
        )
      : null,

    error
      ? h("div", { class: "cmd-result-error", role: "alert", style: "animation: fadeIn 0.3s ease-in;" }, error)
      : null,
  );
}

// ── Export Panel ─────────────────────────────────────────────────────

function ExportPanel() {
  const cliName = useCliName();
  const [state, setState] = useState<OpState>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outDir, setOutDir] = useState("");
  const [pdfState, setPdfState] = useState<OpState>("idle");
  const [pdfOutput, setPdfOutput] = useState<string | null>(null);
  const [deployGithub, setDeployGithub] = useState(false);
  const [basePath, setBasePath] = useState("");
  const [cname, setCname] = useState("");
  const [confirmingDeploy, setConfirmingDeploy] = useState(false);
  const [includeTranscripts, setIncludeTranscripts] = useState(false);

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
    setConfirmingDeploy(false);

    try {
      const res = await fetch("/api/commands/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outDir: outDir.trim() || undefined,
          basePath: deployGithub ? (basePath.trim() || undefined) : undefined,
          cname: deployGithub ? (cname.trim() || undefined) : undefined,
          deploy: deployGithub ? "github" : undefined,
          // Reaching handleExport with deployGithub set means the user passed
          // through the confirmation dialog below; carry that consent to the
          // route, which refuses a deploy without it.
          confirmDeploy: deployGithub ? true : undefined,
          includeTranscripts: includeTranscripts || undefined,
        }),
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
  }, [outDir, basePath, cname, deployGithub, includeTranscripts]);

  const handleExportClick = useCallback(() => {
    if (deployGithub) {
      setConfirmingDeploy(true);
      return;
    }
    handleExport();
  }, [deployGithub, handleExport]);

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
      h("label", { class: "overview-deep-toggle" },
        h("input", {
          type: "checkbox",
          checked: deployGithub,
          disabled: state === "running",
          onChange: (e: Event) => {
            setDeployGithub((e.target as HTMLInputElement).checked);
            setConfirmingDeploy(false);
          },
        }),
        ` Deploy to GitHub Pages (push to the n-dx-dashboard branch). Equivalent to `,
        h("code", null, `${cliName} export --deploy=github`), ".",
      ),
      h("label", { class: "overview-deep-toggle" },
        h("input", {
          type: "checkbox",
          checked: includeTranscripts,
          disabled: state === "running",
          onChange: (e: Event) => setIncludeTranscripts((e.target as HTMLInputElement).checked),
        }),
        " Include agent transcripts (tool inputs/outputs and event streams). Off by default — these can contain secrets or file contents the agent read.",
      ),
      deployGithub
        ? h(Fragment, null,
            h("label", { class: "cmd-panel-label" }, "Base path (optional \u2014 auto-detected from git remote)"),
            h("input", {
              type: "text",
              class: "cmd-panel-input",
              placeholder: "/my-repo/",
              value: basePath,
              onInput: (e: Event) => setBasePath((e.target as HTMLInputElement).value),
              disabled: state === "running",
            }),
            h("label", { class: "cmd-panel-label" }, "Custom domain / CNAME (optional)"),
            h("input", {
              type: "text",
              class: "cmd-panel-input",
              placeholder: "dashboard.example.com",
              value: cname,
              onInput: (e: Event) => setCname((e.target as HTMLInputElement).value),
              disabled: state === "running",
            }),
          )
        : null,
    ),

    confirmingDeploy
      ? h("div", { class: "prune-confirmation-warning", role: "alert" },
          h("div", { class: "prune-confirmation-warning-icon" }, "\u26a0"),
          h("div", null,
            h("strong", null, "This force-pushes to a remote branch."),
            h("p", null,
              "Exporting will overwrite the n-dx-dashboard branch on this repo's git remote (origin) with the freshly generated dashboard. This is visible to anyone with access to the remote and cannot be undone by this dashboard.",
            ),
            h("p", null,
              includeTranscripts
                ? "Agent transcripts (tool inputs/outputs and event streams) WILL be published — these can contain secrets or file contents the agent read. Uncheck “Include agent transcripts” above to publish only run summaries."
                : "Published: PRD items, analysis data, and hench run summaries. Agent transcripts are excluded.",
            ),
            h("div", { class: "cmd-panel-actions" },
              h("button", {
                class: "cmd-btn cmd-btn-secondary",
                onClick: () => setConfirmingDeploy(false),
              }, "Cancel"),
              h("button", {
                class: "cmd-btn cmd-btn-primary",
                onClick: handleExport,
              }, "Export & Deploy"),
            ),
          ),
        )
      : h("div", { class: "cmd-panel-actions" },
          h("button", {
            class: "cmd-btn cmd-btn-primary",
            onClick: handleExportClick,
            disabled: state === "running",
          }, state === "running" ? "Exporting..." : deployGithub ? "Export & Deploy\u2026" : "Export Dashboard"),
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

export function SelfHealPanel({ jobs }: { jobs: JobTray }) {
  const cliName = useCliName();
  const [confirmed, setConfirmed] = useState(false);
  const [iterations, setIterations] = useState(3);
  const [error, setError] = useState<string | null>(null);
  // Set by Reset, so a finished run's log can be cleared without waiting for
  // the tray's retention window to drop the row.
  const [dismissed, setDismissed] = useState(false);

  const op = findOperation(jobs.operations, "self-heal");
  const [statusData, clearStatus] = useFinishedStatus<SelfHealStatusData>(op, "/api/commands/self-heal/status");

  const state: OpState = error
    ? "error"
    : dismissed || !op
      ? "idle"
      : op.status === "running"
        ? "running"
        : op.status === "failed"
          ? "error"
          : "done";

  const handleStart = useCallback(async () => {
    setError(null);
    setDismissed(false);
    clearStatus();

    try {
      const res = await fetch("/api/commands/self-heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iterations }),
      });

      // 409 means it is already running — which is the state the caller
      // wanted, so the tray simply picks it up like any other run.
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    }
    // Show the run in the tray now rather than at the next poll tick.
    await jobs.refresh();
  }, [iterations, jobs, clearStatus]);

  const handleStop = useCallback(() => {
    if (op) void jobs.stop(op);
  }, [op, jobs]);

  const handleReset = useCallback(() => {
    setConfirmed(false);
    setError(null);
    setDismissed(true);
    clearStatus();
  }, [clearStatus]);

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
          "Once started it runs unattended — no prompts — until it finishes or you stop it. " +
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
          op?.startedAt
            ? h("p", { class: "cmd-panel-hint" },
                "Started: ", new Date(op.startedAt).toLocaleTimeString(),
              )
            : null,
          op?.detail
            ? h("p", { class: "cmd-phase-item", role: "status", "aria-live": "polite" }, op.detail)
            : null,
          h("div", { class: "cmd-panel-actions" },
            h("button", {
              class: "cmd-btn cmd-btn-danger",
              onClick: handleStop,
              title: "Stop the loop after the current step",
            }, "Stop"),
          ),
          h("p", { class: "cmd-panel-hint" },
            "Progress and elapsed time are in the job tray, bottom right \u2014 it keeps reporting while you work in another view.",
          ),
        )
      : null,

    state === "done"
      ? h("div", null,
          h("div", { class: "cmd-result-success", role: "status" },
            h("span", { class: "cmd-result-icon" }, op?.stopped ? "\u25A0" : "\u2713"),
            h("span", null, op?.stopped
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
            error || op?.error || statusData?.error || "Unknown error",
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

export function RefreshPanel({ jobs }: { jobs: JobTray }) {
  const cliName = useCliName();
  const [fast, setFast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const op = findOperation(jobs.operations, "refresh");
  const [statusData] = useFinishedStatus<RefreshStatusData>(op, "/api/commands/refresh/status");

  const state: OpState = error
    ? "error"
    : !op
      ? "idle"
      : op.status === "running"
        ? "running"
        : op.status === "failed"
          ? "error"
          : "done";

  const handleStart = useCallback(async () => {
    setError(null);

    try {
      const res = await fetch("/api/commands/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fast }),
      });

      // 409 means one is already running — the tray reports that one.
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    }
    await jobs.refresh();
  }, [fast, jobs]);

  const handleStop = useCallback(() => {
    if (op) void jobs.stop(op);
  }, [op, jobs]);

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
      ? h("div", null,
          h("div", { class: "cmd-progress", role: "status", "aria-live": "polite" },
            h("div", { class: "cmd-spinner", "aria-hidden": "true" }),
            h("span", null, op?.detail || "Refreshing SourceVision data..."),
          ),
          h("div", { class: "cmd-panel-actions" },
            h("button", {
              class: "cmd-btn cmd-btn-danger",
              onClick: handleStop,
              title: "Stop the refresh",
            }, "Stop"),
          ),
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
          op?.stopped
            ? "Refresh stopped by request."
            : "Refresh complete — data views will update automatically.",
        )
      : null,

    state === "error"
      ? h("div", { class: "cmd-result cmd-result-error", role: "alert" },
          error || op?.error || "Refresh failed",
        )
      : null,
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function CommandsView({ jobs }: { jobs: JobTray }) {
  return h("div", { class: "commands-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Commands"),
    ),
    h("p", { class: "section-sub" },
      "Trigger CLI operations directly from the dashboard.",
    ),

    h("div", { class: "cmd-panels" },
      h(RefreshPanel, { jobs }),
      h(InstallSamplePanel, null),
      h(ExportPanel, null),
      h(SelfHealPanel, { jobs }),
    ),
  );
}
