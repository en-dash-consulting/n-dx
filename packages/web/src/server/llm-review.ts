/**
 * The `review` block of `GET /api/llm/config`, and the write-time checks for
 * the keys that feed it.
 *
 * The page renders what this resolves and applies no rule of its own, so the
 * rules — which reviewer is allowed, whether review can run at all — live here.
 * The value rules mirror `ndx config` (`HENCH_VALIDATORS` in
 * `packages/core/config.js`); web cannot import core or hench, so they are
 * restated, with the bounds from hench's `ReviewConfig`.
 */

import { DEFAULT_LLM_VENDOR, LLM_VENDOR, resolveReviewModel } from "@n-dx/llm-client";
import type { LLMConfig, LLMVendor } from "@n-dx/llm-client";
import { VENDOR_PROVIDERS } from "./hench-config-fields.js";
import type { EffectiveAgentConfig, HenchReviewSettings, ReviewSettingSource } from "./effective-agent-config.js";

/** Vendors that can review: the ones with a CLI. */
export const REVIEWER_VENDORS = ["claude", "codex"] as const;
type ReviewerVendor = (typeof REVIEWER_VENDORS)[number];

const REVIEW_MODES = ["off", "self", "pair"] as const;
const MIN_REVIEW_ROUNDS = 1;
const MAX_REVIEW_ROUNDS = 3;
const DEFAULT_REVIEW_MODE = "off";
const DEFAULT_REVIEW_ROUNDS = 2;

/** Which key supplied a reviewer model; same rungs as hench's `reviewModelSource`. */
export type ReviewModelSource = "vendor-config" | "shared-config" | "vendor-default";

export interface ReviewInfo {
  mode: { value: string; source: ReviewSettingSource };
  /** The pair reviewer; `null` when unset and the active vendor has no CLI counterpart. */
  vendor: { value: ReviewerVendor | null; source: ReviewSettingSource };
  rounds: { value: number; source: ReviewSettingSource };
  /** Each CLI vendor's reviewer model. */
  models: Partial<Record<ReviewerVendor, { model: string; source: ReviewModelSource }>>;
  /** Whether review can run: it needs a CLI on both sides. */
  available: boolean;
  /** A sentence for the page; present only when `available` is false. */
  unavailableReason?: string;
  /** Whether pair review (a second vendor reviewing) can run. Constant until it lands. */
  pairSupported: false;
}

function reviewModelFor(vendor: ReviewerVendor, llmConfig: LLMConfig): { model: string; source: ReviewModelSource } {
  const pinned = vendor === LLM_VENDOR.CLAUDE ? llmConfig.claude?.reviewModel : llmConfig.codex?.reviewModel;
  const source: ReviewModelSource = pinned ? "vendor-config" : llmConfig.reviewModel ? "shared-config" : "vendor-default";
  return { model: resolveReviewModel(vendor, llmConfig), source };
}

function unavailableReason(effective: EffectiveAgentConfig): string | undefined {
  if (!VENDOR_PROVIDERS[effective.vendor].includes("cli")) {
    return `Review needs a CLI on both sides, and ${effective.vendor} has no CLI.`;
  }
  if (effective.provider !== "cli") {
    return `Review needs a CLI on both sides, and ${effective.vendor} runs on the API connection.`;
  }
  return undefined;
}

/** The other CLI vendor, which reviews when `hench.review.vendor` is unset. */
function counterpartOf(vendor: LLMVendor): ReviewerVendor | null {
  if (vendor === LLM_VENDOR.CLAUDE) return LLM_VENDOR.CODEX;
  if (vendor === LLM_VENDOR.CODEX) return LLM_VENDOR.CLAUDE;
  return null;
}

export function buildReviewInfo(
  effective: EffectiveAgentConfig,
  llmConfig: LLMConfig,
  settings: HenchReviewSettings,
): ReviewInfo {
  const reason = unavailableReason(effective);
  return {
    mode: settings.mode ?? { value: DEFAULT_REVIEW_MODE, source: "default" },
    vendor: settings.vendor
      ? { value: settings.vendor.value as ReviewerVendor, source: settings.vendor.source }
      : { value: counterpartOf(effective.vendor), source: "default" },
    rounds: settings.rounds ?? { value: DEFAULT_REVIEW_ROUNDS, source: "default" },
    models: {
      claude: reviewModelFor("claude", llmConfig),
      codex: reviewModelFor("codex", llmConfig),
    },
    available: reason === undefined,
    ...(reason ? { unavailableReason: reason } : {}),
    pairSupported: false,
  };
}

/** `llm.<vendor>.reviewModel` for a vendor that can review. */
export const REVIEW_MODEL_PATH = /^llm\.(claude|codex)\.reviewModel$/;

/** Paths this module validates, beyond `REVIEW_MODEL_PATH`. */
export const HENCH_REVIEW_PATHS: ReadonlySet<string> = new Set([
  "hench.review.mode",
  "hench.review.vendor",
  "hench.review.rounds",
]);

/**
 * Refuse a `hench.review.*` value `ndx config` would refuse. `activeVendor` is
 * the `llm.vendor` the project will have once the request is applied. Returns
 * an error message, or null when acceptable (including a delete).
 */
export function validateReviewChange(path: string, value: unknown, activeVendor: string | null): string | null {
  if (value === null || value === "") return null;
  if (path === "hench.review.mode") {
    return REVIEW_MODES.includes(value as never)
      ? null
      : `Invalid review mode "${value}". Expected one of: ${REVIEW_MODES.join(", ")}.`;
  }
  if (path === "hench.review.vendor") {
    if (!REVIEWER_VENDORS.includes(value as never)) {
      return `Invalid reviewer "${value}". Expected one of: ${REVIEWER_VENDORS.join(", ")}.`;
    }
    if (value === (activeVendor ?? DEFAULT_LLM_VENDOR)) {
      return `Reviewer "${value}" is the active vendor. A pair review needs the other vendor.`;
    }
    return null;
  }
  if (path === "hench.review.rounds") {
    const n = Number(value);
    return Number.isInteger(n) && n >= MIN_REVIEW_ROUNDS && n <= MAX_REVIEW_ROUNDS
      ? null
      : `Invalid review rounds "${value}". Expected a whole number from ${MIN_REVIEW_ROUNDS} to ${MAX_REVIEW_ROUNDS}.`;
  }
  return null;
}
