/**
 * Workflow template definitions.
 *
 * Templates are pre-configured workflow setups for common development patterns.
 * Each template provides a partial HenchConfig overlay that gets merged with
 * the current config when applied.
 */

import type { HenchConfig } from "./v1.js";
import { guardDefaultsForLanguage } from "./v1.js";

// ── Template types ────────────────────────────────────────────────────

/**
 * Partial config overlay — only the fields a template wants to change.
 * The `schema` field is excluded since it's not user-configurable.
 */
export type TemplateConfigOverlay = Partial<Omit<HenchConfig, "schema">>;

export interface WorkflowTemplate {
  /** Unique template ID (slug format: lowercase, hyphens). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description of what this template optimizes for. */
  description: string;
  /** Recommended use cases (shown in UI and CLI). */
  useCases: string[];
  /** Tags for filtering/searching. */
  tags: string[];
  /** Config fields this template overrides. */
  config: TemplateConfigOverlay;
  /** Whether this is a built-in template (not deletable). */
  builtIn: boolean;
  /** ISO timestamp of when this template was created (user templates only). */
  createdAt?: string;
}

// ── Built-in templates ────────────────────────────────────────────────
//
// Token budget basis
// ------------------
// `tokenBudget` is measured by `checkTokenBudget`, which counts uncached
// input + cache writes + output and excludes cache reads (a cache read
// re-reads tokens already counted when they were written).
//
// The budgets below are derived from the 26 recorded runs in this
// repository's `.hench/runs/` as of 2026-09, whose counted totals ran
// 176K–2.5M.
//
// Counted cost is affine in turn count, not proportional:
//
//     counted ~= 190,000 + 5,400 x turns        (least-squares fit)
//
// The ~190K constant is the initial context write, which a run pays before
// it does any work. Multiplying a per-turn average by `maxTurns` drops that
// constant and so under-budgets short-run templates badly — a measured
// 11-turn run cost 484K, far above what any per-turn model predicts for 11
// turns. Each budget below is therefore the fit evaluated at the template's
// `maxTurns`, doubled for headroom and rounded up.
//
// Checked against the recorded runs: no *completed* run of a given
// template's turn class reaches that template's budget. The one run that
// does trip (3 turns, 1.13M counted) had already failed, and 1.13M in 3
// turns is the runaway these budgets exist to stop.
//
// The pre-2026-09 values (50K/200K/30K/150K) predate prompt caching and sat
// below a single median run, so any run under a template was marked
// `budget_exceeded` after finishing its work.
//
// A genuinely cheaper template is built with `maxTurns` and `maxTokens`,
// which bound the work. A `tokenBudget` below the ~190K floor plus real
// work does not save money; it just fails runs after they have spent it.

export const BUILT_IN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "quick-iteration",
    name: "Quick Iteration",
    description: "Short, fast runs for rapid prototyping and small fixes",
    useCases: [
      "Bug fixes and small patches",
      "Quick refactors with clear scope",
      "Exploratory changes with fast feedback",
    ],
    tags: ["fast", "lightweight", "prototyping"],
    config: {
      maxTurns: 15,
      tokenBudget: 600000,        // fit(15) = 271K x 2 headroom = 542K, rounded up
      loopPauseMs: 500,
      retry: {
        maxRetries: 2,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
      },
    },
    builtIn: true,
  },
  {
    id: "thorough-execution",
    name: "Thorough Execution",
    description: "Extended runs with generous limits for complex multi-file tasks",
    useCases: [
      "New feature implementation across multiple files",
      "Large refactoring efforts",
      "Tasks requiring extensive test writing",
    ],
    tags: ["thorough", "complex", "multi-file"],
    config: {
      maxTurns: 80,
      maxTokens: 16384,
      tokenBudget: 1500000,       // fit(80) = 619K x 2 headroom = 1.24M, rounded up
      loopPauseMs: 2000,
      retry: {
        maxRetries: 5,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
      },
    },
    builtIn: true,
  },
  {
    id: "budget-conscious",
    name: "Budget Conscious",
    description: "Optimized for minimal token usage while maintaining quality",
    useCases: [
      "Cost-sensitive environments",
      "High-volume task processing",
      "Routine maintenance tasks",
    ],
    tags: ["budget", "cost-effective", "efficient"],
    config: {
      maxTurns: 20,
      maxTokens: 4096,
      // fit(20) = 297K x 2 headroom = 595K, rounded up. Not tightened below
      // quick-iteration despite the name: two measured runs in this turn
      // class *completed* at 484K and 489K, so a lower budget would fail
      // finished work. This template economises through maxTurns and the
      // 4096 maxTokens cap instead.
      tokenBudget: 600000,
      loopPauseMs: 3000,
      retry: {
        maxRetries: 2,
        baseDelayMs: 3000,
        maxDelayMs: 15000,
      },
    },
    builtIn: true,
  },
  {
    id: "strict-safety",
    name: "Strict Safety",
    description: "Maximum guard rails for sensitive codebases and production-adjacent work",
    useCases: [
      "Production infrastructure changes",
      "Security-sensitive code modifications",
      "Regulated environments requiring audit trails",
    ],
    tags: ["safety", "security", "production"],
    config: {
      maxTurns: 30,
      maxFailedAttempts: 2,
      guard: {
        blockedPaths: [
          ".hench/**",
          ".rex/**",
          ".git/**",
          "node_modules/**",
          ".env*",
          "*.pem",
          "*.key",
          "**/secrets/**",
          "**/credentials/**",
        ],
        allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
        commandTimeout: 15000,
        maxFileSize: 524288,
        spawnTimeout: 120000,          // 2 minutes — stricter than default
        maxConcurrentProcesses: 2,     // tighter limit for sensitive work
        allowedGitSubcommands: [
          "status", "add", "commit", "diff", "log",
          "branch", "show", "rev-parse",
        ],                             // no checkout/stash in strict mode
        policy: {
          maxCommandsPerMinute: 30,    // half of default
          maxWritesPerMinute: 15,      // half of default
        },
      },
    },
    builtIn: true,
  },
  {
    id: "api-direct",
    name: "API Direct",
    description: "Use Anthropic API directly instead of Claude Code CLI for headless environments",
    useCases: [
      "CI/CD pipeline integration",
      "Headless server environments",
      "Custom API key management",
    ],
    tags: ["api", "headless", "ci-cd"],
    config: {
      provider: "api",
      maxTurns: 40,
      tokenBudget: 850000,        // fit(40) = 405K x 2 headroom = 809K, rounded up
      retry: {
        maxRetries: 4,
        baseDelayMs: 3000,
        maxDelayMs: 30000,
      },
    },
    builtIn: true,
  },
  {
    id: "go-project",
    name: "Go Project",
    description: "Tuned for Go codebases: Go toolchain commands, vendor blocking, and make support",
    useCases: [
      "Go module projects with go.mod",
      "Projects using Makefiles for build orchestration",
      "Go microservice development",
    ],
    tags: ["go", "golang", "make"],
    config: {
      language: "go",
      guard: guardDefaultsForLanguage("go"),
    },
    builtIn: true,
  },
];

/** Look up a built-in template by ID. */
export function findBuiltInTemplate(id: string): WorkflowTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
