/**
 * "Found run command" — start the project's dev server or a build from the
 * dashboard, and open it when it serves on localhost: an Open app button sits
 * at the foot of the dropdown, opposite Stop.
 *
 * Sits in the top nav beside search, and is always there so it can be found
 * in the same place on every project. It is disabled until the server reports
 * a detected command: a project with no conventional entry point, or a static
 * export with no server to run anything, shows it greyed out with the reason
 * in its tooltip.
 *
 * The dropdown offers the commands the server detected and nothing else.
 * There is no free-text field and no extra-argument field: flags alone are
 * enough to turn a build tool into arbitrary execution, so the server accepts
 * only an id. See `server/routes-run-commands.ts`.
 */
import { h } from "preact";
import { useState, useCallback } from "preact/hooks";

import { useRunCommands, type DetectedCommand } from "../hooks/index.js";
import { RunOutput } from "./run-output.js";

function kindLabel(kind: "run" | "build"): string {
  return kind === "run" ? "run" : "build";
}

export function RunCommandControl({ enabled = true }: { enabled?: boolean }) {
  const { commands, status, loaded, error, start, stop } = useRunCommands(enabled);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const running = status?.running === true;
  // Default to the first run command, falling back to whatever exists.
  const chosen: DetectedCommand | undefined =
    commands.find((c) => c.id === selectedId)
    ?? commands.find((c) => c.kind === "run")
    ?? commands[0];

  const handleStart = useCallback(async () => {
    if (!chosen) return;
    await start(chosen.id);
    setOpen(false);
  }, [chosen, start]);

  // A job survives a reload, so a running one keeps the control usable even
  // if detection were to come back empty.
  const available = enabled && (commands.length > 0 || running);
  if (!available) {
    const reason = !enabled
      ? "Run commands need the dashboard server; a static export has none"
      : loaded
        ? "No run or build command found in this project"
        : "Looking for run and build commands…";
    return h("div", { class: "runcmd" },
      h("button", {
        type: "button",
        class: "runcmd-btn",
        disabled: true,
        title: reason,
        "aria-label": `Run project: ${reason}`,
      },
        h("span", { class: "runcmd-glyph", "aria-hidden": "true" }, "▶"),
        h("span", { class: "runcmd-label" }, enabled && loaded ? "No run command" : "Run"),
      ),
    );
  }

  const statusText = running
    ? status!.label
    : status?.error
      ? status.error
      : status?.stopped
        ? "Stopped"
        : status?.exitCode === 0
          ? "Finished"
          : typeof status?.exitCode === "number"
            ? `Failed (exit ${status.exitCode})`
            : chosen
              ? `Found ${kindLabel(chosen.kind)} command`
              : "";

  // The label is hidden below 1440 px (UX2'), so the state also shows as a
  // modifier class (colour) and in the tooltip.
  const failed = !running && (Boolean(status?.error)
    || (typeof status?.exitCode === "number" && status.exitCode !== 0 && !status.stopped));
  const finished = !running && !failed && status?.exitCode === 0;
  const stateClass = running ? " runcmd-btn--running"
    : failed ? " runcmd-btn--error"
    : finished ? " runcmd-btn--finished"
    : "";
  const title = [statusText, chosen ? `${chosen.label} — from ${chosen.source}` : ""]
    .filter(Boolean).join(" · ") || undefined;

  return h("div", { class: "runcmd" },
    h("button", {
      type: "button",
      class: `runcmd-btn${stateClass}`,
      onClick: () => setOpen(!open),
      "aria-expanded": String(open),
      "aria-haspopup": "true",
      // Below 1440 px the label is hidden and the button is its glyph (UX2'),
      // so the name cannot come from the text.
      "aria-label": statusText ? `Run project: ${statusText}` : "Run project",
      title,
    },
      running
        ? h("span", { class: "runcmd-spinner", "aria-hidden": "true" })
        : h("span", { class: "runcmd-glyph", "aria-hidden": "true" }, "▶"),
      h("span", { class: "runcmd-label" }, statusText),
      h("span", { class: "runcmd-caret", "aria-hidden": "true" }, "▼"),
    ),

    open
      ? h("div", { class: "runcmd-menu", role: "menu" },
          h("div", { class: "runcmd-menu-title" }, "Run or build"),
          h("ul", { class: "runcmd-list" },
            commands.map((c) =>
              h("li", { key: c.id },
                h("button", {
                  type: "button",
                  class: `runcmd-item${c.id === chosen?.id ? " runcmd-item--active" : ""}`,
                  onClick: () => setSelectedId(c.id),
                },
                  h("span", { class: "runcmd-item-label" }, c.label),
                  h("span", { class: "runcmd-item-kind" }, kindLabel(c.kind)),
                ),
              ),
            ),
          ),

          h("div", { class: "runcmd-actions" },
            // The app the command serves, opposite Stop: the URL is the port
            // the process announced, never an assumed default. Once the
            // process ends nothing is served, so the button goes with it.
            running && status?.url
              ? h("a", {
                  class: "runcmd-open",
                  href: status.url,
                  target: "_blank",
                  rel: "noreferrer noopener",
                  title: `Open ${status.url} in a new tab`,
                }, "Open app ↗")
              : null,
            running
              ? h("button", {
                  type: "button",
                  class: "runcmd-stop",
                  onClick: () => { void stop(); },
                }, "Stop")
              : h("button", {
                  type: "button",
                  class: "runcmd-start",
                  disabled: !chosen,
                  onClick: () => { void handleStart(); },
                }, chosen ? `Run ${chosen.label}` : "Run"),
          ),

          error ? h("div", { class: "runcmd-error", role: "alert" }, error) : null,

          status?.output ? h(RunOutput, { output: status.output }) : null,
        )
      : null,
  );
}
