/**
 * Tune's Shipped tile: the PRD's timeline, what was completed when,
 * with the top-level items still open to the right of today
 * (`components/prd-tree/timeline-graph.ts`). The same timeline is the Tasks
 * page's Timeline arrangement; here an item opens on that page rather than in
 * a detail panel, since Tune has none. "Open" still goes to the Merge Graph
 * the tile used to show.
 *
 * It reads the PRD as the Tasks page does (`usePRDData`) and follows the same
 * live updates (`usePRDWebSocket`).
 *
 * @module viewer/views/shipped-timeline
 */

import { h } from "preact";
import type { NavigateTo } from "../types.js";
import { usePRDData, usePRDWebSocket } from "../hooks/index.js";
import { TimelineGraph } from "../components/prd-tree/timeline-graph.js";

export function ShippedTimeline({ navigateTo }: { navigateTo: NavigateTo }) {
  const { data, setData, loading, error, fetchPRDData, fetchTaskUsage } = usePRDData();
  usePRDWebSocket({ setData, fetchPRDData, fetchTaskUsage });
  if (!data) {
    return error
      ? h("p", { class: "shipped-note", role: "alert" }, `Could not read the PRD: ${error}`)
      : h("p", { class: "shipped-note", role: "status" }, loading ? "Loading…" : "No PRD yet.");
  }
  return h("div", { class: "shipped-timeline" },
    h(TimelineGraph, {
      items: data.items,
      onSelectItem: (item) => navigateTo("prd", { taskId: item.id }),
      onShowTree: () => navigateTo("prd"),
    }),
  );
}
