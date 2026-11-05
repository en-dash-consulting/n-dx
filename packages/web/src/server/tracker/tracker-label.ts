/**
 * What a tracker link is called: the label of the server profile of the
 * project's tracker connection ("CAOS"). A profile without a `tracker` mapping
 * names a server, not a tracker, and is skipped; with none, there is no label
 * and a link reads as its key or host.
 */

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
