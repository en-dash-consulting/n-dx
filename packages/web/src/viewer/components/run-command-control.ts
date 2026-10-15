/**
 * "Found run command" — start the project's dev server or a build from the
 * dashboard, and open it when it serves on localhost.
 *
 * Sits in the bottom bar beside the live indicators. It appears only when the
 * server actually detected something, so a project with no conventional entry
 * point gets no empty affordance.
 *
 * Extra arguments are allowed; the command itself is not editable here. The
 * server runs a detected entry by id and takes no binary from the browser, so
 * the dropdown offers what exists rather than a text box that would amount to
 * remote execution. See `server/routes-run-commands.ts`.
 */
import { h, Fragment } from "preact";
import { useState, useCallback } from "preact/hooks";

import { useRunCommands, type DetectedCommand } from "../hooks/index.js";

function kindLabel(kind: "run" | "build"): string {
  return kind === "run" ? "run" : "build";
}

export function RunCommandControl({ enabled = true }: { enabled?: boolean }) {
  const { commands, status, error, start, stop } = useRunCommands(enabled);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extra, setExtra] = useState("");

  const running = status?.running === true;
  // Default to the first run command, falling back to whatever exists.
  const chosen: DetectedCommand | undefined =
    commands.find((c) => c.id === selectedId)
    ?? commands.find((c) => c.kind === "run")
    ?? commands[0];

  const handleStart = useCallback(async () => {
    if (!chosen) return;
    const args = extra.trim() ? extra.trim().split(/\s+/) : [];
    await start(chosen.id, args);
    setOpen(false);
  }, [chosen, extra, start]);

  if (!enabled || commands.length === 0) return null;

  const statusText = running
    ? status!.label
    : status?.error
      ? status.error
      : status?.stopped
        ? "Stopped"
        : status?.exitCode === 0
          ? "Finished"
          : chosen
            ? `Found ${kindLabel(chosen.kind)} command`
            : "";

  return h("div", { class: "runcmd" },
    h("button", {
      type: "button",
      class: `runcmd-btn${running ? " runcmd-btn--running" : ""}`,
      onClick: () => setOpen(!open),
      "aria-expanded": String(open),
      "aria-haspopup": "true",
      title: chosen ? `${chosen.label} — from ${chosen.source}` : undefined,
    },
      running
        ? h("span", { class: "runcmd-spinner", "aria-hidden": "true" })
        : h("span", { class: "runcmd-glyph", "aria-hidden": "true" }, "▶"),
      h("span", { class: "runcmd-label" }, statusText),
      h("span", { class: "runcmd-caret", "aria-hidden": "true" }, "▲"),
    ),

    // A served URL is the point of the whole control, so it sits outside the
    // dropdown where it is reachable without opening anything.
    status?.url
      ? h("a", {
          class: "runcmd-link",
          href: status.url,
          target: "_blank",
          rel: "noreferrer noopener",
        }, status.url.replace(/^https?:\/\//, ""))
      : null,

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

          h("label", { class: "runcmd-extra" },
            "Extra arguments",
            h("input", {
              type: "text",
              class: "runcmd-extra-input",
              value: extra,
              placeholder: "--port 5174",
              disabled: running,
              onInput: (e: Event) => setExtra((e.target as HTMLInputElement).value),
            }),
          ),

          h("div", { class: "runcmd-actions" },
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

          status?.output
            ? h(Fragment, null,
                h("div", { class: "runcmd-menu-title" }, "Output"),
                h("pre", { class: "runcmd-output" }, status.output.slice(-2000)),
              )
            : null,
        )
      : null,
  );
}
