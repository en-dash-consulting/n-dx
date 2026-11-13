/**
 * Which PRD layout the served project uses, read once from `/api/status`.
 *
 * Screens whose words differ between a v1 tree (epic, feature, task) and a v2
 * tree (change, task, subtask) read this. It answers `"v1"` until the read
 * lands and whenever it fails, so a v1 screen never flashes v2 words and a
 * failed read keeps the wording a v1 tree has always had.
 *
 * @module viewer/hooks/use-prd-layout
 */

import { useEffect, useState } from "preact/hooks";

export type PrdLayout = "v1" | "v2";

/** Reads the layout when `enabled`; pass `false` to skip the request (a hidden overlay). */
export function usePrdLayout(enabled = true): PrdLayout {
  const [layout, setLayout] = useState<PrdLayout>("v1");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { rex?: { layout?: string } } | null) => {
        if (!cancelled) setLayout(body?.rex?.layout === "v2" ? "v2" : "v1");
      })
      .catch(() => {
        if (!cancelled) setLayout("v1");
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return layout;
}
