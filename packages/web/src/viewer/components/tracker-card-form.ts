/**
 * A waiting tracker card's call as an editable form (C1's external-call form):
 * Live's Tracker activity and a change's "Create in tracker" both draw it. Send
 * runs the call once with the edited arguments (`POST /api/tracker/cards/decide`);
 * nothing reaches the tracker before that.
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { SidecarExternalCall } from "../hooks/sidecar.js";
import { ExternalCallBody, type ExternalCallEdit } from "./sidecar-external-call.js";

/** The server's error message for a failed response, or `fallback` and the status. */
export async function errorOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON: the fallback says enough.
  }
  return `${fallback} (${res.status})`;
}

interface DecidedEntry {
  result?: string;
  problems?: Array<{ message: string }>;
}

/**
 * Why an approved call did not finish cleanly, or null when it did: an `ok` or
 * `duplicate` result with no problems. An `ok` create whose link failed made the
 * work item, so the operator is told to link it by hand.
 */
function problemOf(entry: DecidedEntry | undefined): string | null {
  const result = entry?.result ?? "ok";
  const detail = (entry?.problems ?? []).map((p) => p.message).join("; ");
  if (result === "ok" || result === "duplicate") {
    return detail ? `${detail}. Link it by hand.` : null;
  }
  return `The tracker did not run the call (${result})${detail ? `: ${detail}` : ""}`;
}

/** Results that leave the card waiting (sync-engine's `isUnreachable`). */
const RETRYABLE: ReadonlySet<string> = new Set(["unavailable", "needs-sign-in"]);

export interface TrackerCardFormProps {
  /** The card: its request id and the call the rules planned. */
  entry: { requestId: string; call: { tool: string; args: Record<string, unknown> } };
  onDone: () => void;
  onCancel: () => void;
}

export function TrackerCardForm({ entry, onDone, onCancel }: TrackerCardFormProps) {
  const [call, setCall] = useState<SidecarExternalCall | null>(null);
  const [edit, setEdit] = useState<ExternalCallEdit>(entry.call.args);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

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
      if (!res.ok) { setError(await errorOf(res, "Could not run the call")); return; }
      const { entry: decided } = (await res.json()) as { entry?: DecidedEntry };
      const problem = problemOf(decided);
      if (!problem) { onDone(); return; }
      setError(problem);
      // An unreachable call leaves the card waiting, so Run may retry; any other result closed it.
      if (!RETRYABLE.has(decided?.result ?? "")) setClosed(true);
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
      h("button", { type: "button", class: "cmd-btn cmd-btn-primary", "data-action": "send", disabled: busy || closed || !call || !edit, onClick: () => { void send(); } },
        busy ? "Running…" : `Run ${entry.call.tool}`),
      h("button", { type: "button", class: "cmd-btn cmd-btn-secondary", disabled: busy, onClick: onCancel }, "Cancel"),
    ),
  );
}
