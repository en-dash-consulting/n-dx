/**
 * A change's tracker chip and "Create in tracker" (Sidecar tracker sync, SP8),
 * on Plan's Open changes rows and in the change detail.
 *
 * A linked change shows the tracker's label, the state sync last put it in,
 * and a link when its ref is a URL. An unlinked one offers "Create in tracker":
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
import { useFeatureToggle } from "../hooks/index.js";
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
    chip.state ? h("span", { class: "tracker-chip-state" }, chip.state) : null,
  );
}

/** The chip, or "Create in tracker", for one change: the detail panel's form of the row's pair. `refreshKey` re-reads after the item reloaded. */
export function ChangeTrackerChip({ changeId, refreshKey }: { changeId: string; refreshKey?: unknown }) {
  const { read, reload } = useTrackerChips(refreshKey);
  return h("div", { class: "change-tracker-chip" },
    h(TrackerChip, { changeId, read }),
    h(CreateInTrackerButton, { changeId, read, onCreated: reload }),
  );
}

type Raised = { requestId: string; call: { tool: string; args: Record<string, unknown> } };

/** "Create in tracker" for a change with no link; nothing when it links or no tracker can sync. */
export function CreateInTrackerButton({ changeId, read, onCreated }: { changeId: string; read: TrackerChipRead; onCreated?: () => void }) {
  const [card, setCard] = useState<Raised | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!read.label || read.changes[changeId]) return null;

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

  return h("span", { class: "create-in-tracker" },
    card
      ? h(TrackerCardForm, { entry: card, onDone: () => { setCard(null); onCreated?.(); }, onCancel: () => setCard(null) })
      : h("button", { type: "button", class: "ch-change-link create-in-tracker-button", disabled: busy, onClick: () => { void raise(); } },
        `Create in ${read.label}`),
    error ? h("span", { class: "live-error", role: "alert" }, error) : null,
  );
}
