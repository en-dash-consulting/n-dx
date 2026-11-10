/**
 * A linked change's current tracker state, read live for the change detail
 * (SP8): one call to the profile's `readTool` on the work item the ref names,
 * kept for {@link ITEM_STATE_TTL_MS} so reopening the panel reads nothing.
 * Open changes rows never read here; they show the state ndx last set
 * (change-chips.ts). A read that fails says why and is not kept, so the next
 * open tries again.
 */

import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { ConnectionUnavailableError } from "../connections/connection-service.js";
import { errorMessage } from "../response-utils.js";
import { dataAt, resultData } from "../sidecar/external-call.js";
import { trackerItemIdOfRef, type TrackerMapping } from "./server-profiles.js";
import type { TrackerSyncService } from "./sync-engine.js";

/** How long a read state is answered without reading again. */
export const ITEM_STATE_TTL_MS = 60_000;
/** The most read states kept; the oldest give way. */
export const MAX_KEPT_ITEM_STATES = 200;

export type TrackerItemState =
  | { ref: string; state: string; readAt: string }
  | { ref: string; state: null; problem: string };

const kept = new Map<string, { until: number; read: TrackerItemState }>();

export interface ItemStateOptions {
  projectDir: string;
  service: Pick<TrackerSyncService, "callTool">;
  connection: string;
  mapping: TrackerMapping;
  /** The clock (tests). */
  now?: () => Date;
}

/** The current state of the work item `ref` names, read through the profile's read tool or kept from a read moments ago. */
export async function readTrackerItemState(options: ItemStateOptions, ref: string): Promise<TrackerItemState> {
  const { projectDir, service, connection, mapping } = options;
  const now = (options.now ?? (() => new Date()))();
  const itemId = trackerItemIdOfRef(mapping, ref);
  const key = `${projectDir}\0${connection}\0${itemId}`;
  const hit = kept.get(key);
  if (hit && hit.until > now.getTime()) return { ...hit.read, ref };
  kept.delete(key);

  const property = mapping.readStatusProperty;
  if (!property) return { ref, state: null, problem: `the profile names no readStatusProperty for ${mapping.readTool}'s reply` };
  let reply;
  try {
    reply = await service.callTool(connection, mapping.readTool, { [mapping.itemIdProperty]: itemId });
  } catch (err) {
    if (err instanceof ConnectionUnavailableError || err instanceof McpError) return { ref, state: null, problem: errorMessage(err) };
    throw err;
  }
  if (reply.isError) return { ref, state: null, problem: `${mapping.readTool} could not read ${itemId}` };
  const state = dataAt(resultData(reply), property);
  if (typeof state !== "string" || state === "") return { ref, state: null, problem: `${mapping.readTool}'s reply has no ${property}` };

  const read: TrackerItemState = { ref, state, readAt: now.toISOString() };
  kept.set(key, { until: now.getTime() + ITEM_STATE_TTL_MS, read });
  if (kept.size > MAX_KEPT_ITEM_STATES) kept.delete(kept.keys().next().value as string);
  return read;
}
