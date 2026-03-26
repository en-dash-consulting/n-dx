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
      tokenBudget: 50000,
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
      tokenBudget: 200000,
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
      tokenBudget: 30000,
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
      tokenBudget: 150000,
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
