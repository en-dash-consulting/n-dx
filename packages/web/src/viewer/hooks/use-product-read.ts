/**
 * One v2 product read as a hook: the Product and Changes pages, the Inbox, the
 * PRD tree and the Sidecar placement card all fetch the same way.
 *
 * It lives in `hooks/` rather than beside the pages so a surface that only
 * needs the read (the hub session drawer) does not import the page views.
 *
 * @module viewer/hooks/use-product-read
 */

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { usePrdChangedRefresh } from "./use-prd-changed-refresh.js";

/** What every product read answers on a v1 tree. */
interface V1Answer { layout: "v1" }

export type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "v1" }
  | { state: "ready"; data: T; refreshError?: string };

/** Why a read failed, for the user. */
export function failureMessage(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : `HTTP ${status}`;
}

/**
 * A failed read. Data already on screen stays, with the failure alongside it:
 * a refetch that fails (a read mid-write) must not replace a loaded page.
 */
function failed<T>(prev: Load<T>, message: string): Load<T> {
  return prev.state === "ready" ? { ...prev, refreshError: message } : { state: "error", message };
}

/**
 * Fetch one product read; `pick` takes the payload out of a v2 answer. It
 * reads again on each `rex:prd-changed`, keeping the current data on screen
 * until the new answer arrives, so the view follows the Tasks tree. A refetch
 * that fails keeps that data and reports through `refreshError`.
 */
export function useProductRead<T>(url: string, pick: (body: Record<string, unknown>) => T): Load<T> {
  return useRefetchableProductRead(url, pick).load;
}

/** `useProductRead` plus a `refetch` for a page that writes and must show the result. */
export function useRefetchableProductRead<T>(
  url: string,
  pick: (body: Record<string, unknown>) => T,
): { load: Load<T>; refetch: () => void } {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const refetch = useCallback(() => setRevision((n) => n + 1), []);
  const loadedUrl = useRef(url);
  usePrdChangedRefresh(refetch);
  useEffect(() => {
    let live = true;
    // A new url is a new read; a revision bump refreshes the same one in place.
    if (loadedUrl.current !== url) {
      loadedUrl.current = url;
      setLoad({ state: "loading" });
    }
    (async () => {
      const res = await fetch(url);
      const body = await res.json() as Record<string, unknown> | V1Answer;
      if (!live) return;
      if (!res.ok) {
        setLoad((prev) => failed(prev, failureMessage(res.status, body)));
      } else if (body.layout === "v1") {
        setLoad({ state: "v1" });
      } else {
        setLoad({ state: "ready", data: pick(body as Record<string, unknown>) });
      }
    })().catch((err: unknown) => {
      if (live) setLoad((prev) => failed(prev, err instanceof Error ? err.message : String(err)));
    });
    return () => { live = false; };
  }, [url, revision]);
  return { load, refetch };
}
