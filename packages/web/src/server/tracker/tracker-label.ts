/**
 * What a tracker link is called: the label of the server profile of the
 * project's tracker connection ("CAOS"). A profile without a `tracker` mapping
 * names a server, not a tracker, and is skipped; with none, there is no label
 * and a link reads as its key or host.
 *
 * Read from config alone: naming a link never connects a server, so a page
 * view or a link card never spawns a stdio server or waits on a slow one.
 */

import type { ConnectionService } from "../connections/connection-service.js";
import { loadServerProfile, type ProfileOptions } from "./server-profiles.js";

/** The label of the first of `profileNames` that maps a tracker, or null. */
export function trackerLabel(profileNames: readonly (string | undefined)[], options: ProfileOptions = {}): string | null {
  for (const name of profileNames) {
    if (!name) continue;
    const profile = loadServerProfile(name, options);
    if (!("problems" in profile) && profile.tracker) return profile.label;
  }
  return null;
}

/** The tracker's label among `service`'s declared connections, without connecting any. */
export function connectionsTrackerLabel(service: Pick<ConnectionService, "connectionIds" | "callContext">): string | null {
  return trackerLabel(service.connectionIds().map((id) => service.callContext(id)?.profile));
}
