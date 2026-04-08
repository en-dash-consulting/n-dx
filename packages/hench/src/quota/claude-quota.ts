/**
 * Claude (Anthropic) budget-based quota adapter.
 *
 * Computes percent-remaining by comparing accumulated token spend this ISO week
 * (read from .hench/runs/*.json) against the configured weekly token budget
 * (read from .n-dx.json tokenUsage.weeklyBudget).
 *
 * Unlike the Codex adapter which queries a live billing API, Anthropic does not
 * expose an equivalent endpoint.  All data is sourced from local files so this
 * adapter is synchronous and never makes network calls.
 *
 * ## Budget resolution order (mirrors web package routes-token-usage.ts)
 *
 *   1. `tokenUsage.weeklyBudget.vendors.claude.models.<model>`  — most specific
 *   2. `tokenUsage.weeklyBudget.vendors.claude.default`         — vendor default
 *   3. `tokenUsage.weeklyBudget.globalDefault`                  — global fallback
 *   4. null (no budget configured)                              — silent skip
 *
 * ## Graceful degradation
 *
 * Returns `{ ok: false, reason: "no_budget" }` (never throws) when:
 *   - `.n-dx.json` is absent or unreadable.
 *   - `tokenUsage.weeklyBudget` is absent or structurally invalid.
 *   - No budget resolves for the claude vendor/model combination.
 *
 * The caller (`checkQuotaRemaining`) treats `ok: false` as a silent skip that
 * never interrupts the inter-run loop.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { QuotaRemaining } from "./types.js";

// ── Public types ──────────────────────────────────────────────────────────────

/** Options for `fetchClaudeQuota`. */
export interface FetchClaudeQuotaOptions {
  /** Project root directory containing `.n-dx.json`. */
  projectDir: string;
  /** Resolved model identifier embedded verbatim in the `QuotaRemaining` result. */
  model: string;
  /**
   * Root of the `.hench` directory containing the `runs/` sub-directory.
   * Defaults to `<projectDir>/.hench`.
   */
  henchDir?: string;
  /**
   * Injectable clock for deterministic unit tests.
   * Defaults to `new Date()`.
   */
  now?: Date;
}

/** Discriminated-union result from `fetchClaudeQuota`. */
export type ClaudeQuotaResult =
  | { readonly ok: true; readonly quota: QuotaRemaining }
  | { readonly ok: false; readonly reason: "no_budget" };

// ── Internal types ────────────────────────────────────────────────────────────

interface VendorWeeklyBudgetScope {
  default?: number;
  models?: Record<string, number>;
}

interface WeeklyBudgetConfig {
  globalDefault?: number;
  vendors?: Record<string, VendorWeeklyBudgetScope>;
}

interface RunTokenData {
  startedAt?: string;
  tokenUsage?: { input?: number; output?: number };
  turnTokenUsage?: Array<{ input?: number; output?: number; vendor?: string }>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isValidBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the weekly token budget for the claude vendor and a given model,
 * using the deterministic fallback order:
 *   vendor+model → vendor default → global default → null
 */
function resolveWeeklyBudget(
  model: string,
  config: WeeklyBudgetConfig,
): number | null {
  const vendorKey = "claude";
  const modelKey = model.toLowerCase();
  const vendorScope = config.vendors?.[vendorKey];

  if (vendorScope?.models && isValidBudget(vendorScope.models[modelKey])) {
    return vendorScope.models[modelKey];
  }
  if (isValidBudget(vendorScope?.default)) {
    return vendorScope.default as number;
  }
  if (isValidBudget(config.globalDefault)) {
    return config.globalDefault as number;
  }
  return null;
}

/**
 * Return an ISO 8601 week key "YYYY-WNN" for the given date.
 *
 * Uses ISO week numbering (weeks start on Monday; the first week of the year
 * contains the first Thursday).  This matches `periodKey("week", ...)` in the
 * web package so that the CLI and dashboard agree on period boundaries.
 */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Sum input+output tokens from `.hench/runs/*.json` for the current ISO week,
 * counting only turns attributed to the claude vendor.
 *
 * Attribution rules:
 *   - If `turnTokenUsage` is present: count turns where `vendor` is "claude"
 *     or absent (backward-compatible with pre-vendor-tagging runs).
 *   - If `turnTokenUsage` is absent: include the run-level `tokenUsage` total
 *     (pre-per-turn-breakdown runs are assumed to be claude).
 */
function computeWeeklySpend(henchDir: string, now: Date): number {
  const currentWeek = isoWeekKey(now);
  const runsDir = join(henchDir, "runs");

  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return 0;
  }

  let total = 0;

  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue;
    try {
      const raw = readFileSync(join(runsDir, file), "utf-8");
      const run = JSON.parse(raw) as RunTokenData;

      if (!run.startedAt) continue;
      if (isoWeekKey(new Date(run.startedAt)) !== currentWeek) continue;

      if (Array.isArray(run.turnTokenUsage) && run.turnTokenUsage.length > 0) {
        // Per-turn breakdown: count only claude turns (or untagged turns).
        for (const turn of run.turnTokenUsage) {
          const v = (turn.vendor ?? "claude").toLowerCase();
          if (v === "claude") {
            total += (turn.input ?? 0) + (turn.output ?? 0);
          }
        }
        continue;
      }

      // No per-turn breakdown: attribute all tokens to claude.
      total += (run.tokenUsage?.input ?? 0) + (run.tokenUsage?.output ?? 0);
    } catch {
      // Skip unreadable or malformed run files.
    }
  }

  return total;
}

/** Load and return the `weeklyBudget` object from `.n-dx.json`, or null. */
function loadWeeklyBudgetConfig(projectDir: string): WeeklyBudgetConfig | null {
  const ndxPath = join(projectDir, ".n-dx.json");
  if (!existsSync(ndxPath)) return null;

  try {
    const raw = readFileSync(ndxPath, "utf-8");
    const root = JSON.parse(raw) as Record<string, unknown>;

    const tokenUsage = root.tokenUsage;
    if (tokenUsage === null || typeof tokenUsage !== "object" || Array.isArray(tokenUsage)) {
      return null;
    }

    const tu = tokenUsage as Record<string, unknown>;
    if (!Object.hasOwn(tu, "weeklyBudget")) return null;

    const wb = tu.weeklyBudget;
    if (wb === null || typeof wb !== "object" || Array.isArray(wb)) return null;

    return wb as WeeklyBudgetConfig;
  } catch {
    return null;
  }
}

// ── Public adapter ────────────────────────────────────────────────────────────

/**
 * Compute budget-based quota remaining for the Claude (Anthropic) provider.
 *
 * Reads the weekly token budget from `.n-dx.json` and the accumulated spend
 * for the current ISO week from `.hench/runs/`, then computes:
 *
 * ```
 * percentRemaining = clamp(0, 100, (1 − weeklySpend / weeklyBudget) × 100)
 * ```
 *
 * Returns `{ ok: false, reason: "no_budget" }` (never throws) when the
 * budget is not configured or cannot be resolved for the given model.
 * Callers must treat `ok: false` as a silent no-op and must never block on it.
 *
 * @param options - Project directory, model, and optional test overrides.
 * @returns `{ ok: true, quota }` on success or `{ ok: false, reason }` on skip.
 */
export function fetchClaudeQuota(options: FetchClaudeQuotaOptions): ClaudeQuotaResult {
  const henchDir = options.henchDir ?? join(options.projectDir, ".hench");
  const now = options.now ?? new Date();

  const budgetConfig = loadWeeklyBudgetConfig(options.projectDir);
  if (budgetConfig === null) {
    return { ok: false, reason: "no_budget" };
  }

  const budget = resolveWeeklyBudget(options.model, budgetConfig);
  if (budget === null) {
    return { ok: false, reason: "no_budget" };
  }

  const weeklySpend = computeWeeklySpend(henchDir, now);
  const percentRemaining = Math.max(0, Math.min(100, (1 - weeklySpend / budget) * 100));

  return {
    ok: true,
    quota: {
      vendor: "claude",
      model: options.model,
      percentRemaining,
    },
  };
}
