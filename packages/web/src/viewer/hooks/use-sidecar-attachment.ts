/**
 * What the Sidecar drawer is attached to, and the lens it asks with.
 *
 * The page the operator is on names an item (a task, a capability, a zone, or
 * the Plan and Live pages as a whole). That item becomes the session's target,
 * and the page picks the default lens. The lens list is the server's registry
 * (`GET /api/sidecar/lenses`), never a list kept here: a lens the registry
 * reports as unavailable is shown as "not available yet" and the session runs
 * General until that source lands.
 *
 * Pure helpers first, then {@link useSidecarAttachment}.
 */

import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import type { ViewId } from "../types.js";

/** One entry of GET /api/sidecar/lenses. */
export interface SidecarLensInfo {
  id: string;
  available: boolean;
  needs?: string;
}

export type SidecarPageItemKind = "task" | "capability" | "zone" | "plan" | "live";

/** The thing the current page is about. `ref` is what the lens packet is pointed at; Plan and Live have none. */
export interface SidecarPageItem {
  kind: SidecarPageItemKind;
  ref?: string;
  label: string;
}

export const GENERAL_LENS = "general";

/** The page selections that address an item. */
export interface SidecarPageSelection {
  view: ViewId;
  zone: string | null;
  taskId: string | null;
  /** The capability opened inside the Product page, which has no route of its own. */
  capabilityId?: string | null;
}

/** The item the page is about; null when it is about none (Home, Files, …). */
export function pageItemFor(page: SidecarPageSelection): SidecarPageItem | null {
  if (page.taskId && (page.view === "prd" || page.view === "live-task" || page.view === "work")) {
    return { kind: "task", ref: page.taskId, label: page.taskId };
  }
  if (page.view === "zones" && page.zone) return { kind: "zone", ref: page.zone, label: page.zone };
  if (page.view === "product" && page.capabilityId) {
    return { kind: "capability", ref: page.capabilityId, label: page.capabilityId };
  }
  if (page.view === "plan") return { kind: "plan", label: "Plan" };
  if (page.view === "live" || page.view === "live-analyze") return { kind: "live", label: "Live" };
  return null;
}

/** The lens id a page item asks for, before the registry is consulted. */
export function wantedLensFor(item: SidecarPageItem | null, lastRunFailed: boolean): string {
  switch (item?.kind) {
    case "task": return lastRunFailed ? "diagnose-run" : "describe";
    case "capability":
    case "zone": return "explain";
    case "plan": return "plan";
    case "live": return "guide";
    default: return GENERAL_LENS;
  }
}

/** The lens as chosen, and the lens the session actually runs. */
export interface ResolvedLens {
  /** What the chip names. */
  wanted: string;
  /** What the session runs: `wanted`, or General while the registry cannot run it. */
  running: string;
  /** What the lens waits on, when it is not available yet. */
  needs?: string;
}

/**
 * Settle `wanted` against the registry. A lens the registry does not list is
 * unavailable too, and so is every lens until the registry has answered —
 * except General, which sends no packet.
 */
export function resolveLens(wanted: string, registry: readonly SidecarLensInfo[] | null): ResolvedLens {
  if (wanted === GENERAL_LENS) return { wanted, running: GENERAL_LENS };
  const entry = registry?.find((l) => l.id === wanted);
  if (entry?.available) return { wanted, running: wanted };
  return { wanted, running: GENERAL_LENS, needs: entry?.needs ?? "a lens this build knows" };
}

/** `diagnose-run` → `Diagnose run`. */
export function lensLabel(id: string): string {
  const spaced = id.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface SidecarAttachment {
  /** The item attached as the session's target; null when none, or the operator removed it. */
  item: SidecarPageItem | null;
  /**
   * The page is about an item, so it has a say in the session's lens and
   * target. On a page about nothing (Home, Files) a session keeps what it has.
   */
  asks: boolean;
  /** The registry's lenses, in its order; empty until it answers. */
  lenses: SidecarLensInfo[];
  lens: ResolvedLens;
  /** Switch the lens. A lens the registry cannot run is refused (false). */
  chooseLens: (id: string) => boolean;
  /** Detach the item: the session loses its target. */
  removeItem: () => void;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

/**
 * @param enabled  `web.sidecar` is on
 * @param open     the drawer is open; nothing is read while it is closed
 * @param page     the current page's selections
 *
 * The operator's lens choice and a removed item hold for the page item they
 * were made on; moving to another page item starts again from its default.
 */
export function useSidecarAttachment(enabled: boolean, open: boolean, page: SidecarPageSelection): SidecarAttachment {
  const [registry, setRegistry] = useState<SidecarLensInfo[] | null>(null);
  const [failedTask, setFailedTask] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ key: string; lens: string } | null>(null);
  const [removedKey, setRemovedKey] = useState<string | null>(null);

  const pageItem = pageItemFor(page);
  const key = pageItem ? `${pageItem.kind}:${pageItem.ref ?? ""}` : "";
  const taskRef = pageItem?.kind === "task" ? pageItem.ref ?? null : null;

  useEffect(() => {
    if (!enabled || !open || registry) return;
    let live = true;
    void fetchJson<{ lenses: SidecarLensInfo[] }>("/api/sidecar/lenses").then((body) => {
      if (live && Array.isArray(body?.lenses)) setRegistry(body.lenses);
    });
    return () => { live = false; };
  }, [enabled, open, registry]);

  // The newest run of the task decides Describe or Diagnose run.
  useEffect(() => {
    if (!enabled || !open || !taskRef) return;
    let live = true;
    void fetchJson<Array<{ status: string }> | { runs: Array<{ status: string }> }>(
      `/api/hench/runs?taskId=${encodeURIComponent(taskRef)}&limit=1`,
    ).then((body) => {
      if (!live) return;
      const runs = Array.isArray(body) ? body : body?.runs ?? [];
      setFailedTask(runs[0]?.status === "failed" ? taskRef : null);
    });
    return () => { live = false; };
  }, [enabled, open, taskRef]);

  const item = pageItem && removedKey !== key ? pageItem : null;
  const wanted = choice && choice.key === key
    ? choice.lens
    : wantedLensFor(pageItem, taskRef !== null && failedTask === taskRef);
  const lens = useMemo(() => resolveLens(wanted, registry), [wanted, registry]);

  const chooseLens = useCallback((id: string): boolean => {
    if (resolveLens(id, registry).running !== id) return false;
    setChoice({ key, lens: id });
    return true;
  }, [registry, key]);
  const removeItem = useCallback(() => setRemovedKey(key), [key]);

  return { item, asks: pageItem !== null, lenses: registry ?? [], lens, chooseLens, removeItem };
}
