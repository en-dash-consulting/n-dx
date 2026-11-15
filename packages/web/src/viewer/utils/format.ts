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

/** A count with its noun: `1 change`, `3 changes`. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

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

/**
 * Format a size on disk as `512 B`, `1.5 KB` or `2.0 MB` (one decimal, MB at
 * most): a file the batch import reads or the inventory lists, the space a
 * prune frees.
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The text of a caught value: an Error's message, anything else as a string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * "5m 30s" — time from `startedAt` until now, for a live-ticking run. A start
 * in the future (clock skew) reads `0s`.
 */
export function formatElapsedSince(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/**
 * Format a run duration from ISO start/end timestamps.
 * Returns "running…" when end is absent, "—" for negative durations.
 */
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
