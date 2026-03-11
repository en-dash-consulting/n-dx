/**
 * ElapsedTime — memoized component for live-ticking elapsed time display.
 *
 * Isolates the 1-second tick re-renders from parent components. When the
 * shared tick timer fires, only this small component re-renders — the
 * parent card (which may contain links, badges, metadata chips, etc.)
 * is unaffected.
 *
 * Usage:
 * ```tsx
 * // Before: useTick inside the card triggers full card re-render every second
 * //   const elapsed = useTick(run.startedAt, formatElapsed);
 * //   return h("span", null, elapsed);
 *
 * // After: only the ElapsedTime component re-renders
 * //   return h(ElapsedTime, { startedAt: run.startedAt, formatter: formatElapsed });
 * ```
 */

import { h } from "preact";
import { useTick } from "../hooks/index.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ElapsedTimeProps {
  /** ISO 8601 timestamp of when the timer began. */
  startedAt: string;
  /** Pure function that converts a start timestamp to a display string. */
  formatter: (startedAt: string) => string;
  /** Optional CSS class for the wrapping <span>. */
  class?: string;
  /** Optional title attribute for tooltip. */
  title?: string;
}

// ── Component ────────────────────────────────────────────────────────

/**
 * Renders a live-updating elapsed time string. The tick timer state is
 * confined to this component, so parent components avoid re-rendering
 * on every 1-second tick.
 */
export function ElapsedTime({ startedAt, formatter, class: className, title }: ElapsedTimeProps) {
  const display = useTick(startedAt, formatter);

  return h("span", {
    class: className ?? undefined,
    title: title ?? undefined,
    "data-elapsed": true, // marker for testing / styling
  }, display);
}
