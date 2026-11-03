/**
 * The hub session drawer's data beside the session itself: whether the host
 * can run the hub lens, the hub context ceiling, and how many snapshot items
 * the next turn marks Δ. Everything is read through the hub at
 * `/hub/session/…` (server/routes-sidecar.ts, "The hub session").
 *
 * The paths come with the page: the host injects {@link HubSessionPageConfig}
 * when it serves the drawer, so the hub's own path table stays on the server
 * side of the viewer's gateway.
 *
 * The session's transcript and turns are `useSidecar` with
 * {@link hubSidecarEndpoint}; this hook only adds what the drawer head and the
 * composer's meter draw.
 */

import { useEffect, useState } from "preact/hooks";
import { webSocketUrl } from "../external.js";
import type { SidecarEndpoint } from "./use-sidecar.js";

/** Mirrors `HubSessionPageConfig` in server/routes-sidecar.ts. */
export interface HubSessionPageConfig {
  sessions: string;
  lens: string;
  snapshot: string;
  handoff: string;
  socket: string;
  closeMessage: string;
}

/** The id of the JSON block the host injects; `HUB_SESSION_PAGE_CONFIG_ID` on the server. */
const CONFIG_ID = "hub-session-config";

/** The config the host served the page with; null when the page was not served by a host. */
export function readHubSessionPageConfig(doc: Document = document): HubSessionPageConfig | null {
  const text = doc.getElementById(CONFIG_ID)?.textContent;
  if (!text) return null;
  let parsed: Partial<HubSessionPageConfig>;
  try {
    parsed = JSON.parse(text) as Partial<HubSessionPageConfig>;
  } catch {
    return null;
  }
  const keys = ["sessions", "lens", "snapshot", "handoff", "socket", "closeMessage"] as const;
  return keys.every((k) => typeof parsed[k] === "string") ? (parsed as HubSessionPageConfig) : null;
}

/** The hub-scope session through the hub: Claude only, on the hub lens. */
export function hubSidecarEndpoint(config: HubSessionPageConfig): SidecarEndpoint {
  return {
    sessions: config.sessions,
    socketUrl: () => webSocketUrl(location.protocol, location.host, config.socket),
    fixed: { vendor: "claude", lens: "hub" },
  };
}

/** Mirrors `HubLensResponse` in server/routes-sidecar.ts. */
export interface HubLensInfo {
  lens: { id: string; available: boolean; needs?: string };
  ceiling: number;
}

/** Mirrors `HubSnapshotDeltaResponse` in server/routes-sidecar.ts. */
export interface HubSnapshotDelta {
  session: string | null;
  changed: number | null;
  omitted?: number;
  generatedAt?: string;
  error?: string;
  /** The worktrees the snapshot read; absent before the session's first delivered turn. */
  worktrees?: HubSnapshotWorktree[];
}

/** Mirrors `HubSnapshotWorktreeRef` in server/sidecar/hub-snapshot.ts. */
export interface HubSnapshotWorktree {
  project: string;
  projectName: string;
  key: string;
  branch: string | null;
  changed: boolean;
}

/**
 * "Open in worktree sidecar": the host hands the session's latest question to
 * that worktree's session through the hub. Answers the dashboard address that
 * opens the worktree's drawer on it, or why it could not.
 */
export async function requestHubHandoff(
  config: HubSessionPageConfig,
  target: Pick<HubSnapshotWorktree, "project" | "key">,
): Promise<{ url: string } | { error: string }> {
  try {
    const res = await fetch(config.handoff, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: target.project, worktree: target.key }),
    });
    const body = (await res.json().catch(() => null)) as { url?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.url === "string") return { url: body.url };
    return { error: typeof body?.error === "string" ? body.error : `The host answered ${res.status}` };
  } catch (err) {
    return { error: `The host did not answer: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface HubSessionInfo {
  /** Null until the host answers, and when it does not. */
  lens: HubLensInfo | null;
  /** `loading` while a read is out; null before the first. */
  snapshot: HubSnapshotDelta | "loading" | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

/**
 * @param config     the paths the page was served with
 * @param open       the drawer is open; nothing is read while it is closed
 * @param sessionId  the open session; a new one is read again
 * @param running    a turn runs; the Δ is read again once it settles, when
 *                   the turn has taken the snapshot it counts against
 */
export function useHubSessionInfo(
  config: HubSessionPageConfig,
  open: boolean,
  sessionId: string | null,
  running: boolean,
): HubSessionInfo {
  const [lens, setLens] = useState<HubLensInfo | null>(null);
  const [snapshot, setSnapshot] = useState<HubSessionInfo["snapshot"]>(null);

  useEffect(() => {
    if (!open || lens) return;
    let live = true;
    void getJson<HubLensInfo>(config.lens).then((body) => {
      if (live && body?.lens) setLens(body);
    });
    return () => { live = false; };
  }, [config.lens, open, lens]);

  useEffect(() => {
    if (!open || running) return;
    let live = true;
    setSnapshot("loading");
    void getJson<HubSnapshotDelta>(config.snapshot).then((body) => {
      if (live) setSnapshot(body ?? { session: sessionId, changed: null, error: "the host did not answer" });
    });
    return () => { live = false; };
  }, [config.snapshot, open, sessionId, running]);

  return { lens, snapshot };
}
