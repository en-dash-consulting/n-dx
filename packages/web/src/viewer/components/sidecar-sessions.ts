/**
 * The Sidecar sessions list (drawer state C): each session's name, branch,
 * lens, agent, turns, cost and waiting cards. This worktree's sessions offer
 * Resume, Rename and End (End asks first); an ended one offers its transcript
 * instead, read-only. "All worktrees" adds the other worktrees' sessions,
 * which only read.
 */

import { h } from "preact";
import { useState, useEffect } from "preact/hooks";
import type { SidecarState, SidecarSessionRow } from "../hooks/index.js";

function SessionRow({ row, sidecar, onOpened }: { row: SidecarSessionRow; sidecar: SidecarState; onOpened: () => void }) {
  const { session, estimatedCost } = row.entry;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.name);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const ended = session.endedAt !== undefined;

  const open = async () => { if (await sidecar.openSession(session.id)) onOpened(); };
  const saveName = async () => {
    const name = draft.trim();
    if (!name || name === session.name) { setRenaming(false); setDraft(session.name); return; }
    if (await sidecar.sessions.rename(session.id, name)) setRenaming(false);
  };
  const confirmEnd = async () => {
    await sidecar.sessions.end(session.id);
    setConfirmingEnd(false);
  };

  const agent = session.model ? `${session.vendor} · ${session.model}` : session.vendor;
  return h("li", { class: `sidecar-session${ended ? " sidecar-session--ended" : ""}`, "data-session": session.id, "data-own": row.own ? "true" : "false" },
    renaming
      ? h("form", {
          class: "sidecar-session-rename",
          onSubmit: (e: Event) => { e.preventDefault(); void saveName(); },
        },
          h("input", {
            class: "sidecar-session-name-input",
            "aria-label": "Session name",
            value: draft,
            onInput: (e: Event) => setDraft((e.target as HTMLInputElement).value),
          }),
          h("button", { type: "submit", class: "sidecar-session-save" }, "Save"),
          h("button", { type: "button", onClick: () => { setRenaming(false); setDraft(session.name); } }, "Cancel"),
        )
      : h("div", { class: "sidecar-session-title" },
          h("span", { class: "sidecar-session-label" }, session.name),
          ended ? h("span", { class: "sidecar-session-state" }, "ended") : null,
          row.waiting > 0 ? h("span", { class: "sidecar-session-waiting", title: "Cards waiting" }, `${row.waiting} waiting`) : null,
        ),
    h("div", { class: "sidecar-session-meta" },
      h("span", { class: "sidecar-session-branch" }, row.branch ?? (row.own ? "detached" : row.worktree)),
      session.lens ? h("span", { class: "sidecar-session-lens" }, session.lens) : null,
      h("span", { class: "sidecar-session-agent" }, agent),
      h("span", { class: "sidecar-session-turns" }, session.turns === 1 ? "1 turn" : `${session.turns} turns`),
      estimatedCost ? h("span", { class: "sidecar-session-cost" }, estimatedCost.total) : null,
    ),
    row.own && !renaming
      ? confirmingEnd
        ? h("div", { class: "sidecar-session-confirm", role: "alert" },
            h("span", null, "End this session?"),
            h("button", { type: "button", class: "sidecar-session-end-confirm", onClick: () => { void confirmEnd(); } }, "End session"),
            h("button", { type: "button", onClick: () => setConfirmingEnd(false) }, "Keep"),
          )
        : h("div", { class: "sidecar-session-actions" },
            h("button", { type: "button", class: "sidecar-session-open", onClick: () => { void open(); } },
              ended ? "Transcript" : "Resume"),
            h("button", { type: "button", class: "sidecar-session-rename-btn", onClick: () => setRenaming(true) }, "Rename"),
            ended ? null : h("button", { type: "button", class: "sidecar-session-end", onClick: () => setConfirmingEnd(true) }, "End"),
          )
      : null,
  );
}

export function SidecarSessions({ sidecar, onOpened }: { sidecar: SidecarState; onOpened: () => void }) {
  const { sessions } = sidecar;
  const { reload } = sessions;
  useEffect(() => { void reload(); }, [reload]);

  return h("section", { class: "sidecar-sessions", "aria-label": "Sessions" },
    h("div", { class: "sidecar-sessions-filter", role: "group", "aria-label": "Show sessions from" },
      (["this", "all"] as const).map((value) =>
        h("button", {
          key: value,
          type: "button",
          class: `sidecar-sessions-filter-btn${sessions.filter === value ? " active" : ""}`,
          "aria-pressed": sessions.filter === value ? "true" : "false",
          onClick: () => sessions.setFilter(value),
        }, value === "this" ? "This worktree" : "All worktrees")),
    ),
    sessions.error ? h("p", { class: "sidecar-error", role: "alert" }, sessions.error) : null,
    sessions.rows.length === 0
      ? h("p", { class: "sidecar-empty" }, "No sessions yet.")
      : h("ul", { class: "sidecar-session-list" },
          sessions.rows.map((row) => h(SessionRow, { key: `${row.worktree}/${row.entry.session.id}`, row, sidecar, onOpened }))),
  );
}
