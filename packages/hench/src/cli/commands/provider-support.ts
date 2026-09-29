/**
 * Which providers hench's agent loop accepts per vendor.
 *
 * Single source of truth for `cmdRun`'s provider gates in `run.ts`. The
 * dashboard's model/provider catalog (`packages/web/src/server/routes-llm.ts`,
 * via `packages/web/src/server/hench-config-fields.ts`) and its hench-config
 * save path cannot import hench at runtime — hench sits above the domain
 * packages web depends on — so they keep a separately maintained literal.
 * `tests/integration/cross-package-contracts.test.js` pins the two together
 * against the compiled dist artifacts, the same one-directional pattern
 * `tests/e2e/hench-config-gate-contract.test.js` already uses for
 * `HenchConfigSchema`.
 *
 * Rules, from `cmdRun`'s pre-flight checks (near run.ts:1531 as of this
 * writing):
 * - claude has both a CLI (Claude Code) and a direct API path.
 * - codex only has a CLI — hench refuses `provider="api"` for it.
 * - google and local have no CLI binary — hench silently runs them on `api`
 *   even when `provider="cli"` was configured.
 */

import { LLM_VENDOR } from "../../prd/llm-gateway.js";
import type { LLMVendor } from "../../prd/llm-gateway.js";

/** The two ways hench can drive a vendor: spawn its CLI, or call its API directly. */
export type HenchProvider = "cli" | "api";

/** Providers each vendor accepts, in the order hench prefers them. */
export const VENDOR_PROVIDERS: Readonly<Record<LLMVendor, readonly HenchProvider[]>> = {
  [LLM_VENDOR.CLAUDE]: ["cli", "api"],
  [LLM_VENDOR.CODEX]: ["cli"],
  [LLM_VENDOR.GOOGLE]: ["api"],
  [LLM_VENDOR.LOCAL]: ["api"],
};

/** Whether `vendor` accepts `provider`, per {@link VENDOR_PROVIDERS}. */
export function isProviderSupported(vendor: LLMVendor, provider: HenchProvider): boolean {
  return VENDOR_PROVIDERS[vendor].includes(provider);
}
