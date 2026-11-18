/**
 * Metric classification helpers for visualization components.
 *
 * Extracted from utils.ts to give visualization zones a focused import
 * target for metric display logic (health gauges, detail panels, etc.).
 */

/** Classify a 0–1 metric value as good/mid/bad for meter display. */
export function meterClass(value: number, invert: boolean = false): string {
  const v = invert ? 1 - value : value;
  if (v >= 0.7) return "good";
  if (v >= 0.4) return "mid";
  return "bad";
}

/** A zone the health views flag: cohesion under 0.4 or coupling over 0.5. */
export function zoneNeedsAttention(zone: { cohesion: number; coupling: number }): boolean {
  return zoneConcerns(zone).length > 0;
}

/** The two zone metrics the health views judge a zone by. */
export type ZoneConcern = "cohesion" | "coupling";

/** Which of a zone's metrics flag it: cohesion under 0.4, coupling over 0.5. */
export function zoneConcerns(zone: { cohesion: number; coupling: number }): ZoneConcern[] {
  const concerns: ZoneConcern[] = [];
  if (zone.cohesion < 0.4) concerns.push("cohesion");
  if (zone.coupling > 0.5) concerns.push("coupling");
  return concerns;
}
