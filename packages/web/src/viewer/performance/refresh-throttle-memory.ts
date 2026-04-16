/**
 * Local memory-monitor bridge for the refresh throttle pipeline.
 *
 * Keeps the refresh-throttle hook/core coupled to a small local seam instead
 * of the broader performance barrel.
 */

import {
  getCurrentLevel,
  getLatestSnapshot,
  onSnapshot,
} from "./memory-monitor.js";

export type MemoryLevel = "normal" | "elevated" | "warning" | "critical";

export function getInitialRefreshThrottleMemoryLevel(): MemoryLevel {
  return getLatestSnapshot()?.level ?? getCurrentLevel();
}

export function subscribeToRefreshThrottleMemoryLevel(
  listener: (level: MemoryLevel) => void
): () => void {
  return onSnapshot((snapshot) => listener(snapshot.level));
}
