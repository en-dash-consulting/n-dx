import { useEffect, useState } from "react";
import type { SyncHandle, SyncStatus } from "../sync/engine.js";
import { Icon } from "./kit.js";

let handle: SyncHandle | undefined;
const waiting = new Set<(h: SyncHandle | undefined) => void>();

/** The one sync loop this face runs; the faces set it, the rail reads it. */
export function setSync(next: SyncHandle | undefined): void {
  handle = next;
  for (const w of waiting) w(handle);
}

function ago(date?: Date): string {
  if (!date) return "";
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

/** What the rail says about the loop: off, running, synced, or what rex kept. */
export function SyncStatusLine({ off }: { off?: string }) {
  const [current, setCurrent] = useState<SyncHandle | undefined>(handle);
  const [status, setStatus] = useState<SyncStatus | undefined>(handle?.status());
  const [, tick] = useState(0);
  useEffect(() => {
    waiting.add(setCurrent);
    return () => void waiting.delete(setCurrent);
  }, []);
  useEffect(() => (current ? current.subscribe(setStatus) : undefined), [current]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  if (!current) {
    return (
      <p className="ndx-sync" data-testid="sync-off">
        <Icon name="commit" /> <span>Read-only{off ? `: ${off}` : ""}</span>
      </p>
    );
  }
  const r = status?.report;
  const kept = status?.resolved.length ?? 0;
  const pushed = r?.pushed.length ?? 0;
  const refused = r?.refused.length ?? 0;
  const applied = r?.applied.length ?? 0;
  const line = status?.error
    ? `n-dx unreachable: ${status.error}`
    : status?.running
      ? "Syncing with n-dx…"
      : r?.offline
        ? "n-dx offline; edits are queued"
        : `Synced with n-dx ${ago(status?.lastRun)}${pushed ? `, ${pushed} sent` : ""}${applied ? `, ${applied} received` : ""}${refused ? `, ${refused} refused` : ""}`;
  return (
    <div className="ndx-sync" data-testid="sync-status" title={refused && r ? r.refused.map((x) => x.error).join("\n") : undefined}>
      <p>
        <Icon name={status?.error ? "attention" : "commit"} /> <span>{line}</span>
      </p>
      {kept > 0 ? (
        <p className="ndx-small ndx-muted" data-testid="sync-kept">
          rex kept its value for {kept} {kept === 1 ? "field" : "fields"} edited on both sides.
        </p>
      ) : null}
      <button type="button" className="ndx-btn quiet" onClick={() => void current.runNow()} disabled={status?.running}>
        Sync now
      </button>
    </div>
  );
}
