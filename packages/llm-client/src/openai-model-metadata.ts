/** Official OpenAI metadata verified 2026-11-16. See docs/architecture/openai-model-metadata.md.
 * API prices are estimates, never subscription invoices. Missing values are unknown.
 */
import type { ModelCost } from "./config.js";

export type ModelSurface = "api" | "codex" | "work";
export type OpenAIProcessingMode = "standard" | "batch" | "flex" | "fast" | "ultrafast";
export interface ModelEstimateOptions {
  surface?: ModelSurface;
  billing?: "api" | "subscription";
  mode?: OpenAIProcessingMode;
  cacheDuration?: "30m" | "12h";
  /** Full input of ONE request, including cache tokens. Never pass a run aggregate. */
  inputTokens?: number;
}
// input, output, read, 30-minute write, 12-hour write; null means no published write tier.
type Rates = readonly [number, number, number, number | null, number | null];
interface PriceTier { short: Rates; long?: Rates }
export interface OpenAIModelMetadata {
  verifiedOn: string;
  source: string;
  apiContext: number;
  apiMaxInput: number;
  codexContext?: number;
  workContext?: number;
  longContextAbove?: number;
  prices: Partial<Record<OpenAIProcessingMode, PriceTier>>;
}

function entry(id: string, apiContext: number, prices: OpenAIModelMetadata["prices"], longContext = false): OpenAIModelMetadata {
  return {
    verifiedOn: "2026-11-16",
    source: `https://developers.openai.com/api/docs/models/${id}`,
    apiContext,
    // Reserve the documented 128K maximum output where no separate input limit is given.
    apiMaxInput: apiContext - 128_000,
    ...(id === "gpt-6.1-sol" ? { codexContext: 500_000, workContext: 500_000 } : {}),
    ...(longContext ? { longContextAbove: 272_000 } : {}),
    prices,
  };
}

export const OPENAI_MODEL_METADATA: Readonly<Record<string, OpenAIModelMetadata>> = {
  "gpt-5-codex": entry("gpt-5-codex", 400_000, {
    standard: { short: [1.25, 10.0, 0.125, null, null] },
  }),
  "gpt-5.1-codex-max": entry("gpt-5.1-codex-max", 400_000, {
    standard: { short: [1.25, 10.0, 0.125, null, null] },
  }),
  "gpt-5.1-codex-mini": entry("gpt-5.1-codex-mini", 400_000, {
    standard: { short: [0.25, 2.0, 0.025, null, null] },
  }),
  "gpt-5.2": entry("gpt-5.2", 400_000, {
    standard: { short: [1.75, 14.0, 0.175, null, null] },
    batch: { short: [0.875, 7.0, 0.0875, null, null] },
    flex: { short: [0.875, 7.0, 0.0875, null, null] },
    fast: { short: [3.5, 28.0, 0.35, null, null] },
  }),
  "gpt-5.2-codex": entry("gpt-5.2-codex", 400_000, {
    standard: { short: [1.75, 14.0, 0.175, null, null] },
  }),
  "gpt-5.3-codex": entry("gpt-5.3-codex", 400_000, {
    standard: { short: [1.75, 14.0, 0.175, null, null] },
    fast: { short: [3.5, 28.0, 0.35, null, null] },
  }),
  "gpt-5.4": entry("gpt-5.4", 1_050_000, {
    standard: { short: [2.5, 15.0, 0.25, null, null], long: [5.0, 22.5, 0.5, null, null] },
    batch: { short: [1.25, 7.5, 0.13, null, null], long: [2.5, 11.25, 0.25, null, null] },
    flex: { short: [1.25, 7.5, 0.13, null, null], long: [2.5, 11.25, 0.25, null, null] },
    fast: { short: [5.0, 30.0, 0.5, null, null] },
  }, true),
  "gpt-5.4-mini": entry("gpt-5.4-mini", 400_000, {
    standard: { short: [0.75, 4.5, 0.075, null, null] },
    batch: { short: [0.375, 2.25, 0.0375, null, null] },
    flex: { short: [0.375, 2.25, 0.0375, null, null] },
    fast: { short: [1.5, 9.0, 0.15, null, null] },
  }),
  "gpt-5.5": entry("gpt-5.5", 1_050_000, {
    standard: { short: [5.0, 30.0, 0.5, null, null], long: [10.0, 45.0, 1.0, null, null] },
    batch: { short: [2.5, 15.0, 0.25, null, null], long: [5.0, 22.5, 0.5, null, null] },
    flex: { short: [2.5, 15.0, 0.25, null, null], long: [5.0, 22.5, 0.5, null, null] },
    fast: { short: [12.5, 75.0, 1.25, null, null] },
  }, true),
  "gpt-5.6-luna": entry("gpt-5.6-luna", 1_050_000, {
    standard: { short: [0.2, 1.2, 0.02, 0.25, 0.5], long: [0.4, 1.8, 0.04, 0.5, 1.0] },
    batch: { short: [0.1, 0.6, 0.01, 0.125, 0.25], long: [0.2, 0.9, 0.02, 0.25, 0.5] },
    flex: { short: [0.1, 0.6, 0.01, 0.125, 0.25], long: [0.2, 0.9, 0.02, 0.25, 0.5] },
    fast: { short: [0.4, 2.4, 0.04, 0.5, 1.0], long: [0.8, 3.6, 0.08, 1.0, 2.0] },
  }, true),
  "gpt-5.6-sol": entry("gpt-5.6-sol", 1_050_000, {
    standard: { short: [4.0, 20.0, 0.4, 5.0, 10.0], long: [8.0, 30.0, 0.8, 10.0, 20.0] },
    batch: { short: [2.0, 10.0, 0.2, 2.5, 5.0], long: [4.0, 15.0, 0.4, 5.0, 10.0] },
    flex: { short: [2.0, 10.0, 0.2, 2.5, 5.0], long: [4.0, 15.0, 0.4, 5.0, 10.0] },
    fast: { short: [8.0, 40.0, 0.8, 10.0, 20.0], long: [16.0, 60.0, 1.6, 20.0, 40.0] },
  }, true),
  "gpt-5.6-terra": entry("gpt-5.6-terra", 1_050_000, {
    standard: { short: [2.0, 12.0, 0.2, 2.5, 5.0], long: [4.0, 18.0, 0.4, 5.0, 10.0] },
    batch: { short: [1.0, 6.0, 0.1, 1.25, 2.5], long: [2.0, 9.0, 0.2, 2.5, 5.0] },
    flex: { short: [1.0, 6.0, 0.1, 1.25, 2.5], long: [2.0, 9.0, 0.2, 2.5, 5.0] },
    fast: { short: [4.0, 24.0, 0.4, 5.0, 10.0], long: [8.0, 36.0, 0.8, 10.0, 20.0] },
  }, true),
  "gpt-6-astra": entry("gpt-6-astra", 1_050_000, {
    standard: { short: [10.0, 50.0, 1.0, 12.5, 25.0], long: [20.0, 75.0, 2.0, 25.0, 50.0] },
    batch: { short: [5.0, 25.0, 0.5, 6.25, 12.5], long: [10.0, 37.5, 1.0, 12.5, 25.0] },
    flex: { short: [5.0, 25.0, 0.5, 6.25, 12.5], long: [10.0, 37.5, 1.0, 12.5, 25.0] },
    fast: { short: [20.0, 100.0, 2.0, 25.0, 50.0], long: [40.0, 150.0, 4.0, 50.0, 100.0] },
    ultrafast: { short: [60.0, 300.0, 6.0, 75.0, 150.0], long: [120.0, 450.0, 12.0, 150.0, 300.0] },
  }, true),
  "gpt-6-luna": entry("gpt-6-luna", 1_050_000, {
    standard: { short: [0.1, 0.5, 0.01, 0.125, 0.25], long: [0.2, 0.75, 0.02, 0.25, 0.5] },
    batch: { short: [0.05, 0.25, 0.005, 0.0625, 0.125], long: [0.1, 0.375, 0.01, 0.125, 0.25] },
    flex: { short: [0.05, 0.25, 0.005, 0.0625, 0.125], long: [0.1, 0.375, 0.01, 0.125, 0.25] },
    fast: { short: [0.2, 1.0, 0.02, 0.25, 0.5], long: [0.4, 1.5, 0.04, 0.5, 1.0] },
  }, true),
  "gpt-6-sol": entry("gpt-6-sol", 1_050_000, {
    standard: { short: [2.0, 10.0, 0.2, 2.5, 5.0], long: [4.0, 15.0, 0.4, 5.0, 10.0] },
    batch: { short: [1.0, 5.0, 0.1, 1.25, 2.5], long: [2.0, 7.5, 0.2, 2.5, 5.0] },
    flex: { short: [1.0, 5.0, 0.1, 1.25, 2.5], long: [2.0, 7.5, 0.2, 2.5, 5.0] },
    fast: { short: [4.0, 20.0, 0.4, 5.0, 10.0], long: [8.0, 30.0, 0.8, 10.0, 20.0] },
  }, true),
  "gpt-6.1-sol": entry("gpt-6.1-sol", 1_050_000, {
    standard: { short: [2.0, 10.0, 0.1, 2.5, 5.0], long: [4.0, 15.0, 0.2, 5.0, 10.0] },
    batch: { short: [1.0, 5.0, 0.05, 1.25, 2.5], long: [2.0, 7.5, 0.1, 2.5, 5.0] },
    flex: { short: [1.0, 5.0, 0.05, 1.25, 2.5], long: [2.0, 7.5, 0.1, 2.5, 5.0] },
    fast: { short: [4.0, 20.0, 0.2, 5.0, 10.0], long: [8.0, 30.0, 0.4, 10.0, 20.0] },
    ultrafast: { short: [12.0, 60.0, 0.6, 15.0, 30.0], long: [24.0, 90.0, 1.2, 30.0, 60.0] },
  }, true),
  "gpt-6.1-terra": entry("gpt-6.1-terra", 1_050_000, {
    standard: { short: [1.0, 5.0, 0.05, 1.25, 2.5], long: [2.0, 7.5, 0.1, 2.5, 5.0] },
    batch: { short: [0.5, 2.5, 0.025, 0.625, 1.25], long: [1.0, 3.75, 0.05, 1.25, 2.5] },
    flex: { short: [0.5, 2.5, 0.025, 0.625, 1.25], long: [1.0, 3.75, 0.05, 1.25, 2.5] },
    fast: { short: [2.0, 10.0, 0.1, 2.5, 5.0], long: [4.0, 15.0, 0.2, 5.0, 10.0] },
  }, true),
};

/** Normalize only for metadata lookup; never change the operator's execution pin. */
export function resolveOpenAIModel(model: string): OpenAIModelMetadata | undefined {
  const id = model.trim().toLowerCase().replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
  return Object.hasOwn(OPENAI_MODEL_METADATA, id) ? OPENAI_MODEL_METADATA[id] : undefined;
}

/** Strict lookup: unavailable mode/duration/model or subscription billing has no API quote. */
export function resolveOpenAICost(model: string, options: ModelEstimateOptions = {}): ModelCost | undefined {
  if (options.billing === "subscription" || (options.surface && options.surface !== "api" && options.billing !== "api")) return undefined;
  const metadata = resolveOpenAIModel(model);
  if (!metadata) return undefined;
  const tier = metadata.prices[options.mode ?? "standard"];
  const long = metadata.longContextAbove !== undefined && (options.inputTokens ?? 0) > metadata.longContextAbove;
  const rates = long ? tier?.long : tier?.short;
  if (!rates) return undefined;
  const write = rates[options.cacheDuration === "12h" ? 4 : 3];
  if (options.cacheDuration && write === null) return undefined;
  return {
    inputPerMToken: rates[0], outputPerMToken: rates[1], cacheReadPerMToken: rates[2],
    // Legacy automatic caching has no separate write premium; uncached input is billed normally.
    cacheWritePerMToken: write ?? rates[0],
  };
}

/** Compatibility projections: standard, short-context API rates and API maximum windows. */
export const OPENAI_MODEL_COSTS: Readonly<Record<string, ModelCost>> = Object.fromEntries(
  Object.keys(OPENAI_MODEL_METADATA).map((id) => [id, resolveOpenAICost(id)!]),
);
export const OPENAI_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(OPENAI_MODEL_METADATA).map(([id, metadata]) => [id, metadata.apiContext]),
);
