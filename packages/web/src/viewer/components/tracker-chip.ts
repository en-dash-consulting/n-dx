/**
 * A change's tracker chip and "Create in tracker" (Sidecar tracker sync, SP8),
 * on Plan's Open changes rows and in the change detail.
 *
 * A linked change shows the tracker's label, the state ndx last put it in
 * (labelled so: someone may have moved it since) or "linked · state unknown",
 * and a link when its ref is a URL. Rows never call the tracker; the change
 * detail reads the item's current state once when it opens. An unlinked one offers "Create in tracker":
 * it raises the create card (`POST /api/tracker/changes/:id/create`, which
 * makes no tracker call) and draws the card's form inline; Run sends it, and
 * until then nothing is written but the waiting card, which Live also lists.
 *
 * Both read `GET /api/tracker/changes`, once per page load and again when
 * something here changed. With `web.sidecar` off or no usable tracker
 * connection the answer carries no tracker, and neither draws.
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { useCliName, useFeatureToggle } from "../hooks/index.js";
import { TrackerCardForm, errorOf } from "./tracker-card-form.js";
import { linkHref, linkText } from "./tracker-links.js";

export interface TrackerChipRead {
  /** The tracker's label; null while no connection and profile can sync. */
  label: string | null;
  /** The linked changes, and those sync created a work item for: refs (empty until linked) and the state sync last set. */
  changes: Record<string, { refs: string[]; state: string | null }>;
}

const NONE: TrackerChipRead = { label: null, changes: {} };

/** `body` as a chip read, or none when it is not one. */
export function asTrackerChipRead(body: unknown): TrackerChipRead {
  if (!body || typeof body !== "object") return NONE;
  const { tracker, changes } = body as { tracker?: { label?: unknown } | null; changes?: unknown };
  if (!tracker || typeof tracker.label !== "string" || !changes || typeof changes !== "object") return NONE;
  const out: TrackerChipRead["changes"] = {};
  for (const [id, chip] of Object.entries(changes as Record<string, { refs?: unknown; state?: unknown }>)) {
    if (!Array.isArray(chip?.refs)) continue;
    const refs = chip.refs.filter((r): r is string => typeof r === "string");
    const state = typeof chip.state === "string" ? chip.state : null;
    if (refs.length > 0 || state !== null) out[id] = { refs, state };
  }
  return { label: tracker.label, changes: out };
}

/** The chips and a way to read them again. Empty while `web.sidecar` is off. */
export function useTrackerChips(refreshKey?: unknown): { read: TrackerChipRead; reload: () => void } {
  const enabled = useFeatureToggle("web.sidecar", false);
  const [read, setRead] = useState<TrackerChipRead>(NONE);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!enabled) { setRead(NONE); return; }
    let live = true;
    fetch("/api/tracker/changes")
      .then(async (res) => (res.ok ? asTrackerChipRead(await res.json()) : NONE))
      .then((next) => { if (live) setRead(next); })
      .catch(() => { if (live) setRead(NONE); });
    return () => { live = false; };
  }, [enabled, reads, refreshKey]);
  return { read, reload: useCallback(() => setReads((n) => n + 1), []) };
}

/** The chip for a change that links to a work item; nothing otherwise. */
export function TrackerChip({ changeId, read }: { changeId: string; read: TrackerChipRead }) {
  const cli = useCliName();
  const chip = read.changes[changeId];
  if (!read.label || !chip) return null;
  return h("span", { class: "tracker-chip", "data-tracker-chip": changeId },
    // Created by sync but not linked yet: the tracker's name stands for the missing ref.
    chip.refs.length === 0 ? h("span", { class: "tracker-link" }, read.label) : null,
    chip.refs.map((ref) => {
      const href = linkHref(ref);
      const text = linkText(ref, read.label);
      return href
        ? h("a", { key: ref, class: "tracker-link", href, target: "_blank", rel: "noopener noreferrer", title: ref }, text)
        : h("span", { key: ref, class: "tracker-link" }, text);
    }),
    chip.state
      ? h("span", { class: "tracker-chip-state", title: `The state ${cli} last set; the item may have moved in the tracker since` }, `${chip.state} · set by ${cli}`)
      : h("span", { class: "tracker-chip-state tracker-chip-unknown" }, "linked · state unknown"),
  );
}

/** What the change detail's live read answered; null while it is on its way. */
type LiveState = { state: string } | { state: null; problem?: string } | null;

/**
 * The linked work item's current state, read once when the detail opens
 * (`GET /api/tracker/changes/:id/state`, kept a minute on the server). Rows
 * never read it; an unreachable connection reads as unknown.
 */
function TrackerLiveState({ changeId, workRef, label }: { changeId: string; workRef: string; label: string }) {
  const [live, setLive] = useState<LiveState>(null);
  useEffect(() => {
    let current = true;
    setLive(null);
    fetch(`/api/tracker/changes/${encodeURIComponent(changeId)}/state`)
      .then(async (res): Promise<LiveState> => {
        if (!res.ok) return { state: null, problem: await errorOf(res, "Could not read the tracker") };
        const body = (await res.json()) as { state?: unknown; problem?: unknown };
        return typeof body.state === "string" ? { state: body.state } : { state: null, ...(typeof body.problem === "string" && { problem: body.problem }) };
      })
      .catch((err: unknown): LiveState => ({ state: null, problem: err instanceof Error ? err.message : undefined }))
      .then((next) => { if (current) setLive(next); });
    return () => { current = false; };
  }, [changeId, workRef]);
  if (!live) return h("span", { class: "tracker-live-state", "aria-busy": "true" }, `Reading ${label}…`);
  return live.state !== null
    ? h("span", { class: "tracker-live-state" }, `Now in ${label}: `, h("strong", null, live.state))
    : h("span", { class: "tracker-live-state tracker-chip-unknown", ...(live.problem && { title: live.problem }) }, `${label} state unknown`);
}

/** The chip, or "Create in tracker", for one change: the detail panel's form of the row's pair, plus the linked item's current state. `refreshKey` re-reads after the item reloaded. */
export function ChangeTrackerChip({ changeId, refreshKey }: { changeId: string; refreshKey?: unknown }) {
  const { read, reload } = useTrackerChips(refreshKey);
  const workRef = read.changes[changeId]?.refs[0];
  return h("div", { class: "change-tracker-chip" },
    h(TrackerChip, { changeId, read }),
    read.label && workRef ? h(TrackerLiveState, { changeId, workRef, label: read.label }) : null,
    h(CreateInTrackerButton, { changeId, read, onCreated: reload }),
  );
}

type Raised = { requestId: string; call: { tool: string; args: Record<string, unknown> } };

/** "Create in tracker" for a change with no link; nothing when it links or no tracker can sync. */
export function CreateInTrackerButton({ changeId, read, onCreated }: { changeId: string; read: TrackerChipRead; onCreated?: () => void }) {
  const [card, setCard] = useState<Raised | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A linked change shows no button, but a problem from the create that just linked it stays visible.
  if (!read.label || (read.changes[changeId] && !error)) return null;

  const raise = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracker/changes/${encodeURIComponent(changeId)}/create`, { method: "POST" });
      if (!res.ok) { setError(await errorOf(res, "Could not raise the card")); return; }
      const body = (await res.json()) as { requestId: string; entry: { call: Raised["call"] } };
      setCard({ requestId: body.requestId, call: body.entry.call });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not raise the card");
    } finally {
      setBusy(false);
    }
  };

  return h("span", { class: card ? "create-in-tracker create-in-tracker-open" : "create-in-tracker" },
    card
      ? h(TrackerCardForm, { entry: card, onDone: () => { setCard(null); onCreated?.(); }, onSettled: (problem) => { setCard(null); setError(problem); onCreated?.(); }, onCancel: () => setCard(null) })
      : read.changes[changeId]
        ? null
        : h("button", { type: "button", class: "ch-change-link create-in-tracker-button", disabled: busy, onClick: () => { void raise(); } },
          `Create in ${read.label}`),
    error ? h("span", { class: "live-error", role: "alert" }, error) : null,
  );
}
