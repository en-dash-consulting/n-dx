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
// The budgets below are derived from the 27 recorded runs in this
// repository's `.hench/runs/` as of 2026-09. Under this rule those runs
// consumed a median of ~6,000 counted tokens per turn (p75 ~10,300), for
// run totals of 176K–2.5M. Each budget is therefore
//
//     maxTurns x 6,000 counted tokens/turn x 2 headroom
//
// rounded to a round number — high enough that a healthy run at the
// template's turn ceiling does not trip it, low enough to stop a runaway.
// The pre-2026-09 values (50K/200K/30K/150K) predate prompt caching and sat
// below a single median run, so any run under a template was marked
// `budget_exceeded` after finishing its work.

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
      tokenBudget: 200000,        // 15 turns x 6K x 2 headroom = 180K, rounded up
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
      tokenBudget: 1000000,       // 80 turns x 6K x 2 headroom = 960K, rounded up
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
      // 20 turns x 6K x 2 headroom = 240K; held at 150K, a deliberate 1.25x
      // rather than 2x, because this template's purpose is to stop early.
      tokenBudget: 150000,
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
      tokenBudget: 500000,        // 40 turns x 6K x 2 headroom = 480K, rounded up
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
