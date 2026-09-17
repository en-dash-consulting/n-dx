/**
 * Shared viewer formatting utilities.
 *
 * Pure functions with no framework dependencies — safe to import from any
 * viewer component or view file.
 */

/**
 * Format a raw token count as a compact string: 1.2k, 3.4M, or exact.
 * Used for token usage display in prd-tree and run history views.
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format a run duration from ISO start/end timestamps.
 * Returns "running…" when end is absent, "—" for negative durations.
 */
/**
 * "3m ago" — coarse relative time for a past ISO timestamp.
 *
 * Null for a missing, unparseable, or future timestamp: a clock-skewed
 * "in 2 minutes" is worse than saying nothing, and every caller has a
 * non-temporal fallback.
 */
export function formatSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function fmtDuration(start: string, end?: string): string {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}
