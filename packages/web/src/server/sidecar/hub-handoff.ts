/**
 * The hub session's drill-down: "Open in worktree sidecar".
 *
 * The host never opens another repository, so it hands off through the hub
 * like every snapshot read: `POST /p/<id>[/w/<key>]/api/sidecar/handoff` on
 * the worktree's project server, with the per-user token. That server creates
 * or resumes the worktree's session and leaves a `handoff` entry in its
 * ledger naming the hub's question; the answer here says which session it
 * was and the dashboard address that opens its drawer.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §6 (Drill down).
 */

import { errorMessage } from "../response-utils.js";
import { workspaceSlot, type HubAccess } from "./hub-snapshot-fetch.js";
import type { SnapshotWorkspaces } from "./hub-snapshot.js";

/** The project-server route a handoff lands on, under the worktree's slot. */
export const SIDECAR_HANDOFF_PATH = "/api/sidecar/handoff";

/** The query parameter a dashboard opens its drawer on that session for. */
export const SIDECAR_OPEN_PARAM = "sidecar";

/** What `POST /api/sidecar/handoff` takes. */
export interface SidecarHandoffRequest {
  /** The hub's question, which the handoff entry names. */
  question: string;
  /** The vendor a new session opens on; an existing open session keeps its own. */
  vendor: string;
}

/** What `POST /api/sidecar/handoff` answers. */
export interface SidecarHandoffResponse {
  session: { id: string; name: string };
  /** No open session was there to resume. */
  created: boolean;
}

export interface HubHandoffInput extends SidecarHandoffRequest {
  project: string;
  /** The worktree's workspace key. */
  worktree: string;
}

export type HubHandoffResult =
  | { ok: true; session: SidecarHandoffResponse["session"]; created: boolean; url: string }
  | { ok: false; status: 404 | 502; error: string };

const HANDOFF_TIMEOUT_MS = 10_000;

/** Hand the hub's question to the worktree's session, through the hub. */
export async function handOffToWorktree(
  access: HubAccess,
  input: HubHandoffInput,
  opts: { fetch?: typeof fetch } = {},
): Promise<HubHandoffResult> {
  const doFetch = opts.fetch ?? fetch;
  const prefix = `/p/${encodeURIComponent(input.project)}`;
  const token: Record<string, string> = access.token ? { "X-Ndx-Token": access.token } : {};
  /** GET `path`, or POST `json` to it. */
  const call = async <T>(path: string, json?: unknown): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
    try {
      const res = await doFetch(`${access.baseUrl}${path}`, {
        ...(json === undefined
          ? { headers: token }
          : { method: "POST", body: JSON.stringify(json), headers: { ...token, "Content-Type": "application/json" } }),
        signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status} from ${path}${body ? `: ${body.slice(0, 200)}` : ""}` };
      }
      return { ok: true, value: (await res.json()) as T };
    } catch (err) {
      return { ok: false, error: `${path}: ${errorMessage(err)}` };
    }
  };

  const workspaces = await call<SnapshotWorkspaces>(`${prefix}/api/workspaces`);
  if (!workspaces.ok) return { ok: false, status: 502, error: `The project's worktrees could not be read: ${workspaces.error}` };
  if (!workspaces.value.workspaces.some((w) => w.key === input.worktree)) {
    return { ok: false, status: 404, error: `Project ${input.project} has no worktree "${input.worktree}"` };
  }
  const slot = workspaceSlot(workspaces.value, input.worktree);
  const body: SidecarHandoffRequest = { question: input.question, vendor: input.vendor };
  const handed = await call<SidecarHandoffResponse>(`${prefix}${slot}${SIDECAR_HANDOFF_PATH}`, body);
  if (!handed.ok) return { ok: false, status: 502, error: `The worktree's server refused the handoff: ${handed.error}` };
  const { session, created } = handed.value;
  return { ok: true, session, created, url: `${prefix}${slot}/?${SIDECAR_OPEN_PARAM}=${encodeURIComponent(session.id)}` };
}
