/**
 * The hub lens's packet: the hub snapshot, rebuilt for every hub-session turn.
 *
 * The snapshot is read over HTTP through the hub (`hub-snapshot-fetch.ts`)
 * and built against the fingerprints of the session's previous turn, so what
 * changed since then is marked `Δ`. Those fingerprints are kept beside the
 * session's transcript, `<id>.snapshot.json`, so a session picked up by
 * another host after a restart still marks only what changed.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §6.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeRunFileAtomic } from "../run-end.js";
import { errorMessage } from "../response-utils.js";
import { fetchHubSnapshotInput, resolveHubAccess, type FetchHubSnapshotOptions } from "./hub-snapshot-fetch.js";
import { buildHubSnapshot, HUB_SNAPSHOT_CAP, type HubSnapshotState } from "./hub-snapshot.js";
import { HUB_INSTRUCTIONS } from "./lens-instructions.js";
import { assemblePacket, type Packet, type PacketSection } from "./packet.js";
import type { HubSnapshotRead, PacketSources } from "./packet-sources.js";

/** The snapshot plus the header and its instructions. */
export const HUB_PACKET_CAP = HUB_SNAPSHOT_CAP + 1_500;

const SOURCE = "the hub's API (/api/hub/overview, /api/hub/queue) and each project's server behind /p/<id>/";

export async function buildHubPacket(sources: PacketSources, _target: unknown, now: string, signal?: AbortSignal): Promise<Packet> {
  const head = `# Sidecar context packet: hub\nBuilt by code from the hub and each project server's answers. No model wrote it.\n\n${HUB_INSTRUCTIONS}`;
  const read = sources.hubSnapshot ? await sources.hubSnapshot(signal) : "this session is not a hub session";
  const section: PacketSection = typeof read === "string"
    ? {
        id: "snapshot",
        title: "Hub snapshot",
        body: `Not available: ${read}`,
        provenance: { source: SOURCE, generatedAt: now },
        staleness: { state: "unknown", reason: read },
      }
    : {
        id: "snapshot",
        title: "Hub snapshot",
        body: read.text,
        provenance: { source: SOURCE, generatedAt: read.generatedAt },
        staleness: { state: "fresh" },
      };
  return assemblePacket({ lens: "hub", cap: HUB_PACKET_CAP, header: head, sections: [section] });
}

function snapshotStatePath(dir: string, sessionId: string): string {
  return join(dir, `${sessionId}.snapshot.json`);
}

/** A turn has delivered a snapshot to the session, so the next one marks Δ against it. */
export function hasHubSnapshotBaseline(dir: string, sessionId: string): boolean {
  return existsSync(snapshotStatePath(dir, sessionId));
}

function readSnapshotState(dir: string, sessionId: string): HubSnapshotState | null {
  const path = snapshotStatePath(dir, sessionId);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HubSnapshotState>;
  return parsed.fingerprints && typeof parsed.fingerprints === "object" ? { fingerprints: parsed.fingerprints } : null;
}

export interface HubSnapshotReaderOptions extends FetchHubSnapshotOptions {
  /** The per-user directory; defaults to `resolveNdxHome`'s answer. */
  homeDir?: string;
}

/**
 * The hub session's snapshot read: fetched through the hub that
 * {@link resolveHubAccess} names, built against the session's last
 * fingerprints. It replaces them only when the caller runs the read's
 * `commit`, after the model has received the text. A string says why there is none.
 */
export function hubSnapshotReader(
  dir: string,
  sessionId: string,
  opts: HubSnapshotReaderOptions = {},
): (signal?: AbortSignal) => Promise<HubSnapshotRead | string> {
  return async (signal) => {
    const access = resolveHubAccess(opts.homeDir);
    if (!access) return "no hub is running (no hub pid file names a port)";
    try {
      const input = await fetchHubSnapshotInput(access, { ...opts, ...(signal && { signal }) });
      const snapshot = buildHubSnapshot(input, readSnapshotState(dir, sessionId));
      const commit = (): void => {
        writeRunFileAtomic(dir, `${sessionId}.snapshot`, snapshot.state as unknown as Record<string, unknown>);
      };
      return { text: snapshot.text, generatedAt: input.generatedAt, changed: snapshot.changed, omitted: snapshot.omitted, commit };
    } catch (err) {
      return `the hub snapshot could not be built: ${errorMessage(err)}`;
    }
  };
}
