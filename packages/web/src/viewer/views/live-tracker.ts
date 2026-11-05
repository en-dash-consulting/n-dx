/**
 * Live's Tracker activity section (Sidecar tracker sync): what sync did to
 * the linked tracker, from `GET /api/tracker/activity`. Each entry shows when,
 * which item, which event, the call and what became of it: a dry-run `would`,
 * a refusal with the problems the tracker gave, a card waiting for a person,
 * or a connection that cannot be used. A card offers Approve, which opens the
 * call as an editable form and runs it once with the operator's edits, and
 * Dismiss; a revoked sign-in links to Settings > Connections.
 *
 * Shown only while `web.sidecar` is on and a `trackerSync` connection is
 * configured (the route answers `connection: null` otherwise). Reading the
 * answer is `live-tracker-model.ts`.
 *
 * @module web/viewer/views/live-tracker
 */

import { h } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { appUrl } from "../base-path.js";
import { ExternalCallBody, ProblemList, type ExternalCallEdit } from "../components/index.js";
import { useFeatureToggle, type SidecarExternalCall } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { formatSince } from "../utils/format.js";
import {
  activityRows,
  asTrackerActivity,
  eventLabel,
  resultLabel,
  trackerConnectionLabel,
  type TrackerActivity,
  type TrackerActivityRow,
} from "./live-tracker-model.js";

/** The registry key in routes-features.ts. */
export const SIDECAR_FEATURE = "web.sidecar";

async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON: the fallback says enough.
  }
  return `${fallback} (${res.status})`;
}

/** A waiting card's call as a form; Send runs it once with the edited arguments. */
function CardForm({ entry, onDone, onCancel }: { entry: TrackerActivityRow; onDone: () => void; onCancel: () => void }) {
  const [call, setCall] = useState<SidecarExternalCall | null>(null);
  const [edit, setEdit] = useState<ExternalCallEdit>(entry.call.args);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tracker/cards/form?requestId=${encodeURIComponent(entry.requestId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setError(await errorOf(res, "Could not read the call's form")); return; }
        setCall(((await res.json()) as { externalCall: SidecarExternalCall }).externalCall);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not read the call's form"); });
    return () => { cancelled = true; };
  }, [entry.requestId]);

  const send = async (): Promise<void> => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tracker/cards/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: entry.requestId, action: "approve", args: edit }),
      });
      if (res.ok) onDone();
      else setError(await errorOf(res, "Could not run the call"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run the call");
    } finally {
      setBusy(false);
    }
  };

  return h("div", { class: "live-tracker-form" },
    call
      ? h(ExternalCallBody, { call, args: entry.call.args, editable: true, onEdit: setEdit })
      : error ? null : h("p", { class: "live-muted", role: "status" }, "Reading the call's form…"),
    error ? h("p", { class: "live-error", role: "alert" }, error) : null,
    h("div", { class: "live-tracker-actions" },
      h("button", { type: "button", class: "cmd-btn cmd-btn-primary", "data-action": "send", disabled: busy || !call || !edit, onClick: () => { void send(); } },
        busy ? "Running…" : `Run ${entry.call.tool}`),
      h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", disabled: busy, onClick: onCancel }, "Cancel"),
    ),
  );
}

function ActivityRow({ entry, waiting, onChanged }: { entry: TrackerActivityRow; waiting: boolean; onChanged: () => void }) {
  const [approving, setApproving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tracker/cards/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: entry.requestId, action: "dismiss" }),
      });
      if (res.ok) onChanged();
      else setError(await errorOf(res, "Could not dismiss"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss");
    } finally {
      setBusy(false);
    }
  };

  return h("li", { class: "live-tracker-row", "data-result": entry.result, "data-request": entry.requestId },
    h("div", { class: "live-tracker-line" },
      h("span", { class: "live-tracker-when live-muted", title: entry.at }, formatSince(entry.at) ?? entry.at),
      h("span", { class: "live-tracker-item" }, entry.rexId),
      h("span", { class: "live-tracker-event" }, eventLabel(entry.event)),
      h("code", { class: "live-tracker-call" }, entry.call.tool),
      h("span", { class: `live-tracker-result live-tracker-result--${entry.result}` }, resultLabel(entry.result)),
    ),
    entry.problems && entry.problems.length > 0
      ? entry.result === "refused"
        ? h(ProblemList, { problems: entry.problems })
        : h("ul", { class: "live-tracker-problems" }, entry.problems.map((p, i) =>
          h("li", { key: i }, p.field ? h("code", null, p.field) : null, p.field ? " " : null, p.message)))
      : null,
    waiting && !approving
      ? h("div", { class: "live-tracker-actions" },
        h("button", { type: "button", class: "cmd-btn cmd-btn-primary", "data-action": "approve", disabled: busy, onClick: () => setApproving(true) }, "Approve"),
        h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", "data-action": "dismiss", disabled: busy, onClick: () => { void dismiss(); } }, "Dismiss"),
      )
      : null,
    waiting && approving
      ? h(CardForm, { entry, onDone: () => { setApproving(false); onChanged(); }, onCancel: () => setApproving(false) })
      : null,
    error ? h("p", { class: "live-error", role: "alert" }, error) : null,
  );
}

/**
 * The Tracker activity section. `refreshKey` re-reads the log when it
 * changes; Live passes its snapshot's time, so the list follows the same
 * cadence as the rest of the page.
 */
export function TrackerActivitySection({ refreshKey, navigateTo }: { refreshKey: string; navigateTo: NavigateTo }) {
  const enabled = useFeatureToggle(SIDECAR_FEATURE, false);
  const [activity, setActivity] = useState<TrackerActivity | null>(null);
  const [reads, setReads] = useState(0);
  const reread = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) { setActivity(null); return; }
    let cancelled = false;
    fetch("/api/tracker/activity")
      .then(async (res) => (res.ok ? asTrackerActivity(await res.json()) : null))
      .then((read) => { if (!cancelled) setActivity(read); })
      .catch(() => { if (!cancelled) setActivity(null); });
    return () => { cancelled = true; };
  }, [enabled, refreshKey, reads]);

  if (!enabled || !activity) return null;
  const { connection } = activity;
  const rows = activityRows(activity);
  const signIn = connection.state === "needs-sign-in";

  return h("section", { class: "live-tracker", "aria-labelledby": "live-tracker-h" },
    h("h3", { id: "live-tracker-h", class: "live-section-title" }, "Tracker activity"),
    h("p", { class: "live-tracker-connection live-muted" },
      `${connection.label} · `,
      h("span", { class: `live-tracker-state live-tracker-state--${connection.state}` }, trackerConnectionLabel(connection)),
      signIn
        ? [" · ", h("a", {
          key: "settings",
          class: "live-tracker-signin",
          href: appUrl("/project"),
          onClick: (e: MouseEvent) => { e.preventDefault(); navigateTo("project"); },
        }, "Settings > Connections")]
        : null),
    rows.length === 0
      ? h("p", { class: "live-muted" }, "No tracker calls yet.")
      // Keyed by the entry, never its position: the list is newest first, so a
      // new entry would shift every index and remount an open card form.
      : h("ul", { class: "live-tracker-list" }, rows.map(({ entry, waiting }) =>
        h(ActivityRow, { key: `${entry.requestId}:${entry.at}:${entry.result}`, entry, waiting, onChanged: reread }))),
  );
}
