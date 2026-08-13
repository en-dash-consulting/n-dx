/**
 * Commands reference view — server-driven listing of every CLI command.
 *
 * Renders whatever GET /api/commands/manifest returns: category groups of
 * commands with the project-resolved CLI name (cli.name from .n-dx.json),
 * a one-line description, and a computed availability status. Adding a
 * command to the server manifest renders here without component changes.
 */

import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

interface ManifestCommandWire {
  name: string;
  invocation: string;
  description: string;
  status: string;
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
                ),
              ),
              h("tbody", null,
                group.commands.map((cmd) =>
                  h("tr", { key: cmd.name },
                    h("td", { class: "mono-sm" }, h("code", null, cmd.invocation)),
                    h("td", null, cmd.description),
                    h("td", null, h(StatusIndicator, { status: cmd.status })),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}
