/**
 * The Sidecar sessions list: this worktree's sessions, and — under the
 * "All worktrees" filter — the other worktrees' sessions, read-only.
 *
 * Branches come from `GET /api/workspaces`, the registry the workspace
 * switcher reads, never from a git spawn. Another worktree's sessions are read
 * through its own `/w/<key>/api/sidecar/sessions` slot; only this worktree's
 * rows carry the actions (Resume, Rename, End), because the session routes
 * answer 404 for a session that belongs to another checkout. The list reads
 * only when `reload` is called: the list view calls it when it shows and when
 * the filter changes.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { detectBasePath } from "../external.js";
import { getWorkspaceKey } from "../base-path.js";
import type { SidecarCard, SidecarSessionEntry } from "./use-sidecar.js";

export type SidecarSessionFilter = "this" | "all";

/** One row of the list. */
export interface SidecarSessionRow {
  entry: SidecarSessionEntry;
  /** The workspace key the session lives in. */
  worktree: string;
  /** From /api/workspaces; null for a detached HEAD or an unknown workspace. */
  branch: string | null;
  /** This worktree's own: the only rows that offer Resume, Rename and End. */
  own: boolean;
  /** Permission cards waiting on the operator. */
  waiting: number;
}

interface Workspaces {
  anchor: string;
  workspaces: Array<{ key: string; branch: string | null }>;
}

export interface SidecarSessionsState {
  filter: SidecarSessionFilter;
  setFilter: (filter: SidecarSessionFilter) => void;
  rows: SidecarSessionRow[];
  /** The last action's error, cleared by the next. */
  error: string | null;
  reload: () => Promise<void>;
  rename: (id: string, name: string) => Promise<boolean>;
  /** Call the end route. The caller has asked the operator to confirm. */
  end: (id: string) => Promise<boolean>;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

async function send(method: "PATCH" | "POST", url: string, body: unknown): Promise<
  { ok: true; data: SidecarSessionEntry } | { ok: false; error: string }
> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({})) as SidecarSessionEntry & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${res.status})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `path` in worktree `key`'s slot. The fetch adapter prefixes the viewer's own
 * base path, which already holds a `/w/<key>` slot on a non-anchor worktree's
 * page, so that case is addressed absolutely.
 */
export function worktreeApiUrl(key: string, path: string): string {
  const url = `${detectBasePath(location.pathname)}/w/${encodeURIComponent(key)}${path}`;
  return getWorkspaceKey() ? `${location.origin}${url}` : url;
}

const SESSIONS = "/api/sidecar/sessions";

export function useSidecarSessions(opts: {
  /** Cards waiting per session, for this worktree's rows. */
  waitingBySession: Readonly<Record<string, number>>;
  /** A session this worktree holds changed: the drawer follows it if it is open. */
  onChanged: (entry: SidecarSessionEntry) => void;
}): SidecarSessionsState {
  const { waitingBySession, onChanged } = opts;
  const [filter, setFilter] = useState<SidecarSessionFilter>("this");
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState<SidecarSessionEntry[]>([]);
  const [others, setOthers] = useState<Array<Omit<SidecarSessionRow, "branch">>>([]);
  const [workspaces, setWorkspaces] = useState<Workspaces | null>(null);
  const mountedRef = useRef(true);
  const readRef = useRef(0);

  const reload = useCallback(async () => {
    const read = ++readRef.current;
    const [list, spaces] = await Promise.all([
      getJson<{ sessions: SidecarSessionEntry[] }>(SESSIONS),
      getJson<Workspaces>("/api/workspaces"),
    ]);
    if (!mountedRef.current || read !== readRef.current) return;
    if (list) setOwn(list.sessions);
    if (spaces) setWorkspaces(spaces);
    if (filter !== "all" || !spaces) { setOthers([]); return; }
    const here = getWorkspaceKey() ?? spaces.anchor;
    const rows = await Promise.all(spaces.workspaces.filter((w) => w.key !== here).map(async (w) => {
      const body = await getJson<{ sessions: SidecarSessionEntry[] }>(worktreeApiUrl(w.key, SESSIONS));
      return Promise.all((body?.sessions ?? []).map(async (entry) => {
        const cards = entry.session.endedAt
          ? null
          : await getJson<{ cards: SidecarCard[] }>(worktreeApiUrl(w.key, `${SESSIONS}/${encodeURIComponent(entry.session.id)}/cards`));
        const waiting = cards?.cards.filter((c) => c.status === "pending").length ?? 0;
        return { entry, worktree: w.key, own: false, waiting };
      }));
    }));
    if (!mountedRef.current || read !== readRef.current) return;
    setOthers(rows.flat());
  }, [filter]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const change = useCallback(async (method: "PATCH" | "POST", url: string, body: unknown): Promise<boolean> => {
    const res = await send(method, url, body);
    if (!mountedRef.current) return res.ok;
    setError(res.ok ? null : res.error);
    if (res.ok) {
      onChanged(res.data);
      setOwn((prev) => prev.map((e) => (e.session.id === res.data.session.id ? res.data : e)));
    }
    return res.ok;
  }, [onChanged]);

  const rename = useCallback(
    (id: string, name: string) => change("PATCH", `${SESSIONS}/${encodeURIComponent(id)}`, { name }),
    [change],
  );
  const end = useCallback(
    (id: string) => change("POST", `${SESSIONS}/${encodeURIComponent(id)}/end`, {}),
    [change],
  );

  const here = workspaces ? getWorkspaceKey() ?? workspaces.anchor : getWorkspaceKey() ?? "";
  const branchOf = (key: string): string | null => workspaces?.workspaces.find((w) => w.key === key)?.branch ?? null;
  const rows: SidecarSessionRow[] = [
    ...own.map((entry) => ({
      entry, worktree: here, branch: branchOf(here), own: true,
      waiting: waitingBySession[entry.session.id] ?? 0,
    })),
    ...(filter === "all" ? others.map((row) => ({ ...row, branch: branchOf(row.worktree) })) : []),
  ].sort((a, b) => (a.entry.session.lastActivityAt < b.entry.session.lastActivityAt ? 1 : -1));

  return { filter, setFilter, rows, error, reload, rename, end };
}
