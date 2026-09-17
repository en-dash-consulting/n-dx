/**
 * Polls GET /api/rex/claims — the live cross-worktree task claims — for the
 * PRD tree's "claimed · <worktree>" chips and the Sessions tray's per-worktree
 * claimed-task line.
 *
 * Repository-wide like `useWorktrees`: the claims store lives in the git
 * common dir, so every workspace gets the same answer. Read-only — nothing
 * here claims or releases.
 *
 * Refreshed on `hench:run-changed` as well as on the poll tick: a run
 * claims its task just before it writes its first run record, so the
 * broadcast that record triggers is the earliest signal a claim appeared,
 * and the record's final write is the signal it went. The socket path is
 * floored so execution-progress bursts cannot turn into a fetch storm.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";
import { useHenchRunsLiveRefresh } from "./use-hench-runs-live-refresh.js";

/** Mirrors ClaimWire in server/routes-rex/reads.ts. */
export interface ClaimEntry {
  taskId: string;
  taskTitle: string | null;
  worktreeRoot: string;
  worktree: string;
  isServedHere: boolean;
  pid: number;
  host: string;
  claimedAt: string;
  expiresAt: string;
}

/** The acceptance bar is "within one poll interval"; claims change at run cadence, not per second. */
export const CLAIMS_POLL_INTERVAL_MS = 10_000;
const MIN_REFETCH_INTERVAL_MS = 2_000;

/** Index a claims list by task id — what the tree looks rows up in. */
export function indexClaims(claims: readonly ClaimEntry[]): Record<string, ClaimEntry> {
  const byId: Record<string, ClaimEntry> = {};
  for (const c of claims) byId[c.taskId] = c;
  return byId;
}

/** Claims held from one worktree, for the Sessions row of that worktree. */
export function claimsForWorktree(claims: readonly ClaimEntry[] | null, worktreeRoot: string): ClaimEntry[] {
  if (!claims) return [];
  return claims.filter((c) => c.worktreeRoot === worktreeRoot);
}

export function useClaims(): {
  /** null until the first fetch resolves. */
  claims: ClaimEntry[] | null;
  claimsById: Record<string, ClaimEntry>;
  refetch: () => Promise<void>;
} {
  const [claims, setClaims] = useState<ClaimEntry[] | null>(null);
  const lastFetchRef = useRef(0);

  const fetchClaims = useCallback(async () => {
    lastFetchRef.current = Date.now();
    try {
      const res = await fetch("/api/rex/claims");
      if (!res.ok) return;
      const json = (await res.json()) as { claims?: unknown };
      if (Array.isArray(json.claims)) setClaims(json.claims as ClaimEntry[]);
    } catch {
      // Non-fatal — the last known claims stay until the next tick.
    }
  }, []);

  const refreshFromSocket = useCallback(() => {
    if (Date.now() - lastFetchRef.current < MIN_REFETCH_INTERVAL_MS) return;
    void fetchClaims();
  }, [fetchClaims]);

  useEffect(() => { void fetchClaims(); }, [fetchClaims]);
  usePolling("claims", fetchClaims, CLAIMS_POLL_INTERVAL_MS);
  useHenchRunsLiveRefresh(refreshFromSocket);

  const claimsById = useMemo(() => indexClaims(claims ?? []), [claims]);
  return { claims, claimsById, refetch: fetchClaims };
}
