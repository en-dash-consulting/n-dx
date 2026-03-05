/**
 * Messaging integration layer — stable public interface for flow control.
 *
 * ## Responsibility boundary
 *
 * This barrel is the **only sanctioned import path** for viewer-to-server
 * messaging utilities. It isolates consumers (hooks, components) from the
 * internal module structure of the messaging zone. If an internal file is
 * renamed, split, or merged, consumers are unaffected as long as this
 * barrel's exports remain stable.
 *
 * ## Import rules
 *
 * - **Consumers** (hooks, components, views) → import from this barrel.
 * - **Messaging internals** (pipeline files) → may import siblings directly.
 * - **Type-only imports** are exempt (erased at compile time).
 *
 * ## Exports
 *
 * **Composed pipelines (preferred for new consumers):**
 *   - **WSPipeline** — throttle → coalescer chain for WebSocket messages.
 *   - **FetchPipeline** — rate limiter → dedup chain for API fetch calls.
 *
 * **Primitives (for custom composition only):**
 *   - **MessageCoalescer** — batches rapid sequential WebSocket messages
 *     into a single flush to avoid redundant fetch calls.
 *   - **MessageThrottle** — per-type trailing-edge debounce with independent
 *     timers, so different message types throttle at different rates.
 *   - **CallRateLimiter** — caps outbound API call frequency with automatic
 *     queue draining.
 *   - **RequestDedup** — deduplicates in-flight requests by key, returning
 *     the same promise to all concurrent callers.
 *
 * New consumers should prefer the composed pipelines unless they need
 * custom composition. All consumers should import from this barrel rather
 * than individual implementation files.
 */

// ── Composed pipelines (prefer these for new consumers) ──────────

export {
  createWSPipeline,
  type WSPipeline,
  type WSPipelineConfig,
} from "./ws-pipeline.js";

export {
  createFetchPipeline,
  type FetchPipeline,
  type FetchPipelineConfig,
} from "./fetch-pipeline.js";

// ── Primitives (for custom composition) ──────────────────────────

export {
  createCallRateLimiter,
  type CallRateLimiter,
  type CallRateLimiterConfig,
} from "./call-rate-limiter.js";

export {
  createMessageCoalescer,
  type MessageCoalescer,
  type MessageCoalescerConfig,
  type ParsedWSMessage,
  type CoalescedBatch,
} from "./message-coalescer.js";

export {
  createMessageThrottle,
  type MessageThrottle,
  type ThrottledHandlerConfig,
} from "./message-throttle.js";

export {
  createRequestDedup,
  type RequestDedup,
} from "../../shared/request-dedup.js";
