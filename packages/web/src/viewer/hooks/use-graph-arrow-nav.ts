import { useCallback, useRef } from "preact/hooks";

/**
 * Arrow-key navigation over an undirected graph adjacency list.
 *
 * Remembers the last traversed edge so that:
 * - Backward (ArrowLeft/ArrowUp) inverts the last move — pressing forward
 *   then backward returns to the node you came from.
 * - Forward (ArrowRight/ArrowDown) continues past the neighbour you arrived
 *   from, cycling through the node's neighbour list. Alternating forward and
 *   backward from a hub node therefore visits every one of its neighbours,
 *   instead of always jumping to the first entry.
 *
 * @param getNeighbors returns the neighbour ids of a node (render-order list)
 * @param focusNode moves DOM focus to the node with the given id
 */
export function useGraphArrowNav(
  getNeighbors: (nodeId: string) => string[],
  focusNode: (nodeId: string) => void,
): (nodeId: string, e: KeyboardEvent) => void {
  const lastMoveRef = useRef<{ from: string; to: string } | null>(null);

  return useCallback((nodeId: string, e: KeyboardEvent) => {
    const { key } = e;
    if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "ArrowDown" && key !== "ArrowUp") return;
    e.preventDefault();
    const connIds = getNeighbors(nodeId);
    if (connIds.length === 0) return;

    const last = lastMoveRef.current;
    const cameFrom = last && last.to === nodeId ? last.from : null;
    const forward = key === "ArrowRight" || key === "ArrowDown";

    let targetId: string;
    if (forward) {
      const i = cameFrom ? connIds.indexOf(cameFrom) : -1;
      targetId = connIds[(i + 1) % connIds.length];
    } else if (cameFrom && connIds.includes(cameFrom)) {
      targetId = cameFrom;
    } else {
      targetId = connIds[connIds.length - 1];
    }

    lastMoveRef.current = { from: nodeId, to: targetId };
    focusNode(targetId);
  }, [getNeighbors, focusNode]);
}
