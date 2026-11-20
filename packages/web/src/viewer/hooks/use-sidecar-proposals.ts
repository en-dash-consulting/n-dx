/**
 * The change-set cards whose items are not in the PRD yet (UX5), for the
 * Plan tree's ghost rows: waiting on the operator, or approved and still
 * being written. Read from `GET /api/sidecar/proposals`, again on every
 * `sidecar:card` announcement, so a ghost row goes on deny and gives way to
 * the real item on approval. Nothing is read while `web.sidecar` is off.
 */

import { useEffect, useState } from "preact/hooks";
import { getWorkspaceKey } from "../base-path.js";
import { openFrameSocket } from "../live-feed-socket.js";
import { createWSPipeline } from "./use-gateway.js";
import type { SidecarCard } from "./use-sidecar.js";

const PROPOSALS = "/api/sidecar/proposals";

export function useSidecarProposals(enabled: boolean): SidecarCard[] {
  const [cards, setCards] = useState<SidecarCard[]>([]);

  useEffect(() => {
    if (!enabled) {
      setCards([]);
      return;
    }
    let live = true;
    let started = 0;
    let applied = 0;
    // A read that lands after a later-started one has applied is dropped.
    const read = async (): Promise<void> => {
      const n = ++started;
      let next: SidecarCard[] | null = null;
      try {
        const res = await fetch(PROPOSALS);
        next = res.ok ? ((await res.json()) as { cards: SidecarCard[] }).cards : null;
      } catch {
        next = null;
      }
      if (!live || next === null || n < applied) return;
      applied = n;
      setCards(next);
    };
    void read();

    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onFlush: (batch) => {
        if (batch.types.has("sidecar:card")) void read();
      },
      throttledTypes: [],
      coalescerWindowMs: 100,
    });
    // No socket: the ghost rows read once, on mount. A malformed frame is
    // dropped: the next announcement reads the proposals again.
    const closeSocket = openFrameSocket((frame) => pipeline.push(frame));
    return () => {
      live = false;
      pipeline.dispose();
      closeSocket();
    };
  }, [enabled]);

  return cards;
}
