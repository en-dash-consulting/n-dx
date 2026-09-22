/**
 * One-line notice for sourcevision's background narration, shown in the
 * overview header. While a detached `sv narrate` is running the zone names
 * and insights on screen are the judged placeholders; when it failed they
 * never got replaced. Either way the page would otherwise look finished.
 */

import type { Manifest } from "../external.js";

type NarrationState = NonNullable<Manifest["narration"]>;

/** Notice text, or null when narration is absent or done. */
export function narrationNotice(narration: NarrationState | undefined, now: number = Date.now()): string | null {
  if (!narration || narration.status === "done") return null;
  const count = new Set([...(narration.zones ?? []), ...(narration.names ?? [])]).size;
  const what = `${count} zone${count === 1 ? "" : "s"}`;
  if (narration.status === "pending") {
    const minutes = Math.max(0, Math.round((now - Date.parse(narration.startedAt)) / 60_000));
    return `Background narration running for ${what} (started ${minutes} min ago) — names and insights update when it finishes.`;
  }
  return `Background narration failed for ${what}: ${narration.reason ?? "unknown reason"}. Run 'sv narrate .' or re-analyze.`;
}
