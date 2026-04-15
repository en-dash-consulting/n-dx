/**
 * Vendor adapter barrel — factory function + adapter re-exports.
 *
 * The `resolveVendorAdapter` factory replaces the ad hoc `dispatchVendorSpawn`
 * switch in `cli-loop.ts` with a clean adapter lookup. The main loop calls
 * this factory once to obtain the correct adapter, then uses its
 * `buildSpawnConfig` / `parseEvent` / `classifyError` methods throughout
 * the spawn–parse–accumulate cycle.
 *
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 * @see packages/hench/src/agent/lifecycle/cli-loop.ts — consumer
 */

import type { VendorAdapter } from "../vendor-adapter.js";
import type { LLMVendor } from "../../../prd/llm-gateway.js";
import { claudeCliAdapter } from "./claude-cli-adapter.js";
import { codexCliAdapter } from "./codex-cli-adapter.js";

/**
 * Resolve a VendorAdapter for the given LLM vendor.
 *
 * Returns a stateless adapter object whose methods encapsulate all
 * vendor-specific spawn configuration and output parsing. The caller
 * uses the adapter throughout the spawn–parse–accumulate lifecycle
 * without needing to branch on the vendor string.
 *
 * @param vendor — The LLM vendor identifier (e.g. "claude", "codex")
 * @returns The corresponding VendorAdapter implementation
 * @throws Never — unknown vendors fall back to the Claude adapter
 */
export function resolveVendorAdapter(vendor: LLMVendor): VendorAdapter {
  switch (vendor) {
    case "codex":
      return codexCliAdapter;
    case "claude":
    default:
      return claudeCliAdapter;
  }
}

// Re-export adapter instances for direct access
export { claudeCliAdapter } from "./claude-cli-adapter.js";
export { codexCliAdapter } from "./codex-cli-adapter.js";
