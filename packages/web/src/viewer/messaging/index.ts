/**
 * Messaging primitives library — WebSocket flow control utilities.
 *
 * This zone collects four independent, framework-agnostic primitives that
 * regulate the frequency and batching of viewer-to-server message delivery,
 * plus two composed pipelines that capture common usage patterns:
 *
 * **Primitives:**
 *   - **MessageCoalescer** — batches rapid sequential WebSocket messages
 *     into a single flush to avoid redundant fetch calls.
 *   - **MessageThrottle** — per-type trailing-edge debounce with independent
 *     timers, so different message types throttle at different rates.
 *   - **CallRateLimiter** — caps outbound API call frequency with automatic
 *     queue draining.
 *   - **RequestDedup** — deduplicates in-flight requests by key, returning
 *     the same promise to all concurrent callers.
 *
 * **Composed pipelines (preferred for new consumers):**
 *   - **WSPipeline** — throttle → coalescer chain for WebSocket messages.
 *   - **FetchPipeline** — rate limiter → dedup chain for API fetch calls.
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
} from "./request-dedup.js";
