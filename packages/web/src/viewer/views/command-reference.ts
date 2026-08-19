/**
 * Commands reference view — server-driven listing of every CLI command.
 *
 * Renders whatever GET /api/commands/manifest returns: category groups of
 * commands with the project-resolved CLI name (cli.name from .n-dx.json),
 * a one-line description, and a computed availability status. Adding a
 * command to the server manifest renders here without component changes.
 */

import { h } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

interface CommandTriggerWire {
  endpoint: string;
  method: "POST";
  statusEndpoint?: string;
}

interface ManifestCommandWire {
  name: string;
  invocation: string;
  description: string;
  status: string;
  trigger?: CommandTriggerWire;
}

interface ManifestGroupWire {
  id: string;
  label: string;
  commands: ManifestCommandWire[];
}

interface ManifestWire {
  cliName: string;
  groups: ManifestGroupWire[];
}

/** Human labels for availability statuses; unknown statuses pass through. */
const STATUS_LABELS: Record<string, string> = {
  "available": "available",
  "needs-init": "needs init",
  "needs-llm": "needs LLM",
};

function StatusIndicator({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  return h("span", { class: `cmdref-status cmdref-status-${status}` },
    h("span", { class: "cmdref-status-dot", "aria-hidden": "true" }),
    ` ${label}`,
  );
}

type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; at: string; ok: boolean; note?: string };

/**
 * Inline Run control for a trigger-bearing command row.
 *
 * POSTs the manifest-declared endpoint (the same one the command's primary
 * view uses). Async singletons (a `statusEndpoint` is declared) are polled
 * until they report finished; sync triggers resolve on the response.
 */
export function RunCell({ command }: { command: ManifestCommandWire }) {
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trigger = command.trigger!;

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const finish = useCallback((ok: boolean, note?: string) => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setState({ kind: "done", at: new Date().toLocaleTimeString(), ok, note });
  }, []);

  const handleRun = useCallback(async () => {
    setState({ kind: "running" });
    try {
      const res = await fetch(trigger.endpoint, {
        method: trigger.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok && res.status !== 202 && res.status !== 409) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      if (trigger.statusEndpoint && (res.status === 202 || res.status === 409)) {
        // Async singleton — poll until it reports finished.
        pollRef.current = setInterval(async () => {
          try {
            const sRes = await fetch(trigger.statusEndpoint!);
            if (!sRes.ok) return;
            const s = await sRes.json() as { running: boolean; finishedAt: string | null; error: string | null };
            if (!s.running && s.finishedAt) {
              finish(!s.error, s.error ?? undefined);
            }
          } catch {
            // Transient poll errors are ignored
          }
        }, 2000);
      } else {
        finish(true);
      }
    } catch (err) {
      finish(false, err instanceof Error ? err.message : String(err));
    }
  }, [trigger, finish]);

  return h("span", { class: "cmdref-run-cell" },
    h("button", {
      class: "cmd-btn cmd-btn-small cmdref-run",
      onClick: handleRun,
      disabled: command.status !== "available" || state.kind === "running",
      title: command.status !== "available"
        ? `Unavailable: ${STATUS_LABELS[command.status] ?? command.status}`
        : `Run ${command.invocation} from the dashboard`,
    }, state.kind === "running" ? "Running…" : "Run"),
    state.kind === "running"
      ? h("span", { class: "cmdref-run-note", role: "status" }, " running")
      : null,
    state.kind === "done"
      ? h("span", {
          class: `cmdref-run-note ${state.ok ? "" : "cmdref-run-error"}`,
          role: state.ok ? "status" : "alert",
        }, ` last run ${state.at}${state.ok ? " ✓" : ` — ${state.note ?? "failed"}`}`)
      : null,
  );
}

export function CommandReferenceView() {
  const [manifest, setManifest] = useState<ManifestWire | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/commands/manifest");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as ManifestWire;
        if (!cancelled) setManifest(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return h("div", { class: "cmdref-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "All Commands"),
    ),
    h("p", { class: "section-sub" },
      "Every CLI command for this project, grouped by workflow stage.",
      manifest ? h("span", null, " CLI: ", h("code", null, manifest.cliName)) : null,
    ),

    error
      ? h("div", { class: "cmd-result cmd-result-error", role: "alert" },
          `Could not load the command manifest: ${error}`)
      : null,

    !manifest && !error
      ? h("div", { class: "empty-state", role: "status" }, "Loading commands…")
      : null,

    manifest
      ? manifest.groups.map((group) =>
          h("section", { key: group.id, class: "cmdref-group", "aria-label": group.label },
            h("h3", { class: "section-header" }, group.label),
            h("table", { class: "data-table cmdref-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "Command"),
                  h("th", null, "Description"),
                  h("th", null, "Status"),
                  h("th", null, "Actions"),
                ),
              ),
              h("tbody", null,
                group.commands.map((cmd) =>
                  h("tr", { key: cmd.name },
                    h("td", { class: "mono-sm" }, h("code", null, cmd.invocation)),
                    h("td", null, cmd.description),
                    h("td", null, h(StatusIndicator, { status: cmd.status })),
                    h("td", null,
                      cmd.trigger ? h(RunCell, { command: cmd }) : null,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}
