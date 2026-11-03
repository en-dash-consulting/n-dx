/**
 * The hub session drawer: the hub-scope Sidecar session as the hub home docks
 * it (Design §6, UX7; the "Hub" mock board).
 *
 * It is the whole of its page (`hub-session.ts`, served at
 * `/hub/session/drawer`), so it fills its frame and has no resize edge: the
 * hub home owns the dock. Its head says where it stands — the purple
 * "Hub · all projects" scope chip, how much of the snapshot changed since the
 * last turn, and the Hub lens. There is no vendor picker and no lens menu: the
 * session is Claude on the hub lens, for good. The composer says the session
 * reads and drafts, never does, and meters the context against the hub
 * ceiling. Under the head, the snapshot's worktrees each offer "Open in
 * worktree sidecar", which hands the latest question to that worktree's own
 * session and opens its dashboard with the drawer on it.
 *
 * The transcript rows and the cards are the worktree drawer's own
 * (sidecar-drawer.ts, sidecar-cards.ts), so both drawers draw a turn alike.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_CLI_NAME, latestContextTokens, lensLabel, sidecarSetupNeed } from "../hooks/index.js";
import type { HubSessionInfo, HubSnapshotWorktree, SidecarState } from "../hooks/index.js";
import { SidecarFrameRow, pairToolResults } from "./sidecar-drawer.js";
import { SidecarCardList, cardTurnSender } from "./sidecar-cards.js";

/** `40000` → `40k`, `12345` → `12k`, `1234` → `1.2k`, `950` → `950`: one decimal only below 10k. */
export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.max(0, Math.round(tokens)));
  const k = tokens / 1_000;
  return `${k >= 10 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)}k`;
}

/** The snapshot chip's text: the Δ count, or why there is none yet. */
export function snapshotChipLabel(snapshot: HubSessionInfo["snapshot"]): string {
  if (snapshot === null || snapshot === "loading") return "snapshot · reading…";
  if (snapshot.changed !== null) return `snapshot · ${snapshot.changed} Δ since your last turn`;
  if (snapshot.error) return "snapshot · unavailable";
  return "snapshot · read on your first turn";
}

/** The composer's meter: the context the next turn resumes with, against the hub ceiling. */
export function HubCeilingMeter({ used, ceiling }: { used: number; ceiling: number | null }) {
  const max = ceiling ?? 0;
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const level = ratio >= 0.9 ? "high" : ratio >= 0.7 ? "mid" : "low";
  const text = max > 0 ? `${formatTokens(used)} / ${formatTokens(max)}` : formatTokens(used);
  return h("div", {
    class: "hub-ceiling",
    role: "meter",
    "aria-label": "Context against the hub ceiling",
    "aria-valuemin": 0,
    "aria-valuemax": max,
    "aria-valuenow": Math.min(used, max),
    "aria-valuetext": `${text} tokens`,
    "data-level": level,
    title: "At the ceiling the session checkpoints to its ledger and the next turn starts cold",
  },
    h("span", { class: "hub-ceiling-bar", "aria-hidden": "true" },
      h("span", { class: "hub-ceiling-fill", style: { width: `${Math.round(ratio * 100)}%` } })),
    h("span", { class: "hub-ceiling-text" }, text),
  );
}

/**
 * The snapshot's worktrees, each with "Open in worktree sidecar": the drill
 * down (Design §6). It hands the session's latest question to that
 * worktree's own session; `onHandoff` answers why it could not, or null once
 * the page is on its way there.
 */
export function HubWorktreeList({ worktrees, onHandoff }: {
  worktrees: readonly HubSnapshotWorktree[];
  onHandoff: (worktree: HubSnapshotWorktree) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (worktrees.length === 0) return null;
  const open = async (wt: HubSnapshotWorktree) => {
    const id = `${wt.project}\0${wt.key}`;
    setBusy(id);
    setError(null);
    const failed = await onHandoff(wt);
    setBusy(null);
    if (failed) setError(failed);
  };
  return h("details", { class: "hub-worktrees" },
    h("summary", { class: "hub-worktrees-summary" }, `Worktrees · ${worktrees.length}`),
    h("ul", { class: "hub-worktrees-list", "aria-label": "Worktrees in the snapshot" },
      worktrees.map((wt) => {
        const id = `${wt.project}\0${wt.key}`;
        const label = `${wt.projectName} · ${wt.branch ?? wt.key}`;
        return h("li", { key: id, class: "hub-worktree" },
          h("span", { class: "hub-worktree-name", title: `${wt.project} / ${wt.key}` },
            wt.changed ? h("span", { class: "hub-worktree-delta", title: "Changed since your last turn" }, "Δ ") : null,
            label),
          h("button", {
            type: "button",
            class: "hub-worktree-open",
            disabled: busy !== null,
            "aria-label": `Open in worktree sidecar: ${label}`,
            title: "Open this worktree's own Sidecar session, handed your latest question",
            onClick: () => { void open(wt); },
          }, busy === id ? "Opening…" : "Open in worktree sidecar"));
      })),
    error ? h("p", { class: "sidecar-error", role: "alert" }, error) : null,
  );
}

export interface HubSessionDrawerProps {
  sidecar: SidecarState;
  info: HubSessionInfo;
  onClose: () => void;
  /** "Open in worktree sidecar"; without it the drawer lists no worktrees. */
  onHandoff?: (worktree: HubSnapshotWorktree) => Promise<string | null>;
}

export function HubSessionDrawer({ sidecar, info, onClose, onHandoff }: HubSessionDrawerProps) {
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sidecar.frames.length]);

  const setupNeed = sidecarSetupNeed(sidecar.agent, sidecar.catalog, sidecar.lastTurn);
  const busy = sidecar.running || sidecar.sending;
  const submit = async () => {
    if (busy || !draft.trim()) return;
    if (await sidecar.send(draft)) setDraft("");
  };

  const results = pairToolResults(sidecar.frames);
  const rows: ComponentChildren[] = sidecar.frames.map((frame) =>
    h(SidecarFrameRow, { key: frame.seq, frame, result: results.get(frame.seq) }));
  const paused = sidecar.running && sidecar.sessionWaiting > 0;
  const turnFailed = sidecar.lastTurn && sidecar.lastTurn.status !== "completed" ? sidecar.lastTurn : null;
  const lens = info.lens?.lens ?? null;
  const lensNeeds = lens && !lens.available ? lens.needs ?? "a host that can run it" : null;
  const snapshotTitle = info.snapshot && info.snapshot !== "loading" && info.snapshot.error
    ? info.snapshot.error
    : "Items of the hub snapshot changed since the snapshot your last turn read";

  return h("aside", { id: "hub-session-drawer", class: "sidecar-drawer hub-session-drawer", "aria-label": "Hub session" },
    h("header", { class: "sidecar-head hub-session-head" },
      h("div", { class: "hub-session-title-row" },
        h("span", { class: "sidecar-title" }, "Hub session"),
        h("button", { type: "button", class: "sidecar-close", onClick: onClose, "aria-label": "Close Hub session", title: "Close (⌘J)" }, "×"),
      ),
      h("div", { class: "hub-session-chips" },
        h("span", { class: "sidecar-chip sidecar-chip-scope-hub" },
          h("span", { class: "sidecar-chip-label" }, "Hub · all projects")),
        h("span", { class: "sidecar-chip sidecar-chip-snapshot", title: snapshotTitle },
          h("span", { class: "sidecar-chip-label" }, snapshotChipLabel(info.snapshot))),
        h("span", {
          class: "sidecar-chip sidecar-chip-lens",
          title: lensNeeds ? `Waiting on ${lensNeeds}` : "The hub lens: a snapshot of every project, rebuilt each turn",
        },
          h("span", { class: "sidecar-chip-label" }, lensLabel("hub")),
          lensNeeds ? h("span", { class: "sidecar-chip-note" }, "not available") : null),
      ),
    ),
    onHandoff && info.snapshot && info.snapshot !== "loading" && info.snapshot.worktrees
      ? h(HubWorktreeList, { worktrees: info.snapshot.worktrees, onHandoff })
      : null,
    h("ol", { class: "sidecar-transcript", ref: transcriptRef, "aria-live": "polite", "aria-label": "Transcript" },
      rows.length > 0
        ? rows
        : h("li", { class: "sidecar-empty" }, "Ask across every registered project. The hub session reads and drafts; it never runs anything."),
    ),
    // The hub belongs to no project, so there is no project CLI name to read.
    h(SidecarCardList, {
      cards: sidecar.cards, manifest: sidecar.commandManifest, decide: sidecar.decide, send: cardTurnSender(sidecar), cliName: DEFAULT_CLI_NAME,
    }),
    setupNeed
      ? h("div", { class: "sidecar-setup", role: "alert", "data-reason": setupNeed.reason },
          h("p", { class: "sidecar-setup-title" },
            `The ${setupNeed.cli} CLI is ${setupNeed.reason === "missing-cli" ? "not installed" : "not signed in"}`),
          h("p", { class: "sidecar-setup-hint" },
            setupNeed.reason === "missing-cli" ? "Install it on the host, then send again:" : "Sign in, then send your message again:"),
          h("code", { class: "sidecar-setup-command" }, setupNeed.command))
      : null,
    turnFailed && !setupNeed
      ? h("p", { class: "sidecar-turn-end", role: "status" },
          `Turn ${turnFailed.status}${turnFailed.error ? `: ${turnFailed.error}` : ""}`)
      : null,
    sidecar.error ? h("p", { class: "sidecar-error", role: "alert" }, sidecar.error) : null,
    paused
      ? h("div", { class: "sidecar-paused", role: "status" },
          `Agent paused · waiting on ${sidecar.sessionWaiting === 1 ? "your decision" : `${sidecar.sessionWaiting} decisions`}`)
      : null,
    sidecar.readOnly
      ? h("p", { class: "sidecar-readonly", role: "status" }, "This session has ended. Its transcript is read-only.")
      : h("form", {
          class: "sidecar-composer",
          onSubmit: (e: Event) => { e.preventDefault(); void submit(); },
        },
          h("div", { class: "hub-session-composer-meta" },
            h("span", { class: "hub-session-mode", title: "The hub session reads every project and drafts posts, prompts and plans for your approval" },
              "read-only · drafts"),
            h(HubCeilingMeter, { used: latestContextTokens(sidecar.frames), ceiling: info.lens?.ceiling ?? null }),
          ),
          h("textarea", {
            class: "sidecar-input",
            "aria-label": "Message the hub session",
            placeholder: busy ? "A turn is running…" : "Ask across every project",
            value: draft,
            disabled: busy,
            rows: 3,
            onInput: (e: Event) => setDraft((e.target as HTMLTextAreaElement).value),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void submit();
              }
            },
          }),
          h("div", { class: "sidecar-composer-actions" },
            sidecar.running
              ? h("button", { type: "button", class: "sidecar-stop", onClick: () => { void sidecar.stop(); } }, "Stop")
              : null,
            h("button", { type: "submit", class: "sidecar-send", disabled: busy || !draft.trim() }, "Send"),
          ),
        ),
  );
}
