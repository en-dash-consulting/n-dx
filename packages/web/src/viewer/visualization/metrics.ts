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
