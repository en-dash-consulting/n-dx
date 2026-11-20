/**
 * Workflow templates — the named hench config overlays the settings page
 * lists, saves and applies: the built-in set, mirrored from hench, plus the
 * user-defined ones in the project's `templates.json`.
 *
 * GET    /api/hench/templates             — list all workflow templates (built-in + user)
 * GET    /api/hench/templates/:id         — get template details
 * POST   /api/hench/templates             — create/update a user-defined template
 * POST   /api/hench/templates/:id/apply   — apply a template to current config
 * DELETE /api/hench/templates/:id         — delete a user-defined template
 *
 * `routes-hench.ts` dispatches these paths to the handlers here.
 *
 * @module web/server/hench-templates
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { guardBaselineForLanguage, isHenchLocalOnlySetting } from "@n-dx/llm-client";
import { henchDirIn } from "./paths.js";
import type { ServerContext } from "./types.js";
import { commitSettingsChange } from "./settings-commit.js";
import { jsonResponse, errorResponse, readJsonBody, errorMessage } from "./response-utils.js";
import {
  validateConfigKeyValue,
  validateConfigConstraints,
  completeConfigGroups,
  henchConfigPath,
  loadHenchConfig,
} from "./hench-config-fields.js";
import { isRecord } from "../shared/index.js";

// ── Workflow template types (duplicated from hench to avoid runtime coupling) ──

interface WorkflowTemplateData {
  id: string;
  name: string;
  description: string;
  useCases: string[];
  tags: string[];
  config: Record<string, unknown>;
  builtIn: boolean;
  createdAt?: string;
}

/**
 * What the strict-safety template blocks.
 *
 * Both copies of the template — this one and hench's `schema/templates.ts` —
 * now build the list from `guardBaselineForLanguage`, which is in
 * `@n-dx/llm-client` and so is reachable from both. That is the one part of
 * the duplication below that no longer has to be kept in step by hand, and it
 * is the part that most needed not to be: as two hand-written lists they had
 * already drifted from the baseline in two ways, dropping half its credential
 * patterns and naming `.rex`/`.hench` in a spelling a `.ndx/` project does not
 * use. Keep the two derivations identical.
 */
export const STRICT_BLOCKED_PATHS: string[] = [
  ...guardBaselineForLanguage().blockedPaths,
  "**/secrets/**",
  "**/credentials/**",
];

/**
 * Built-in templates — a hand-kept copy of hench/src/schema/templates.ts.
 *
 * Web does not depend on `@n-dx/hench`, so there is no gateway to import these
 * through and no test that can pin the two lists together. Any edit to the
 * hench list must be mirrored here in the same change, `tokenBudget` above all:
 * these values are derived from measured runs and their basis is documented at
 * the top of the hench file.
 */
const BUILT_IN_TEMPLATES: WorkflowTemplateData[] = [
  {
    id: "quick-iteration",
    name: "Quick Iteration",
    description: "Short, fast runs for rapid prototyping and small fixes",
    useCases: ["Bug fixes and small patches", "Quick refactors with clear scope", "Exploratory changes with fast feedback"],
    tags: ["fast", "lightweight", "prototyping"],
    config: { maxTurns: 15, tokenBudget: 600000, loopPauseMs: 500, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000 } },
    builtIn: true,
  },
  {
    id: "thorough-execution",
    name: "Thorough Execution",
    description: "Extended runs with generous limits for complex multi-file tasks",
    useCases: ["New feature implementation across multiple files", "Large refactoring efforts", "Tasks requiring extensive test writing"],
    tags: ["thorough", "complex", "multi-file"],
    config: { maxTurns: 80, maxTokens: 16384, tokenBudget: 1500000, loopPauseMs: 2000, retry: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60000 } },
    builtIn: true,
  },
  {
    id: "budget-conscious",
    name: "Budget Conscious",
    description: "Optimized for minimal token usage while maintaining quality",
    useCases: ["Cost-sensitive environments", "High-volume task processing", "Routine maintenance tasks"],
    tags: ["budget", "cost-effective", "efficient"],
    config: { maxTurns: 20, maxTokens: 4096, tokenBudget: 600000, loopPauseMs: 3000, retry: { maxRetries: 2, baseDelayMs: 3000, maxDelayMs: 15000 } },
    builtIn: true,
  },
  {
    id: "strict-safety",
    name: "Strict Safety",
    description: "Maximum guard rails for sensitive codebases and production-adjacent work",
    useCases: ["Production infrastructure changes", "Security-sensitive code modifications", "Regulated environments requiring audit trails"],
    tags: ["safety", "security", "production"],
    config: { maxTurns: 30, maxFailedAttempts: 2, guard: { blockedPaths: STRICT_BLOCKED_PATHS, allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"], commandTimeout: 15000, maxFileSize: 524288 } },
    builtIn: true,
  },
  {
    id: "api-direct",
    name: "API Direct",
    description: "Use Anthropic API directly instead of Claude Code CLI for headless environments",
    useCases: ["CI/CD pipeline integration", "Headless server environments", "Custom API key management"],
    tags: ["api", "headless", "ci-cd"],
    config: { provider: "api", maxTurns: 40, tokenBudget: 850000, retry: { maxRetries: 4, baseDelayMs: 3000, maxDelayMs: 30000 } },
    builtIn: true,
  },
];

const TEMPLATES_FILE = "templates.json";

/** Load user-defined templates from .hench/templates.json. */
function loadUserTemplates(projectDir: string): WorkflowTemplateData[] {
  const filePath = join(henchDirIn(projectDir), TEMPLATES_FILE);
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkflowTemplateData[];
  } catch {
    return [];
  }
}

/** Get all templates (built-in + user). */
function getAllTemplates(projectDir: string): WorkflowTemplateData[] {
  const builtInIds = new Set(BUILT_IN_TEMPLATES.map((t) => t.id));
  const userTemplates = loadUserTemplates(projectDir).filter((t) => !builtInIds.has(t.id));
  return [...BUILT_IN_TEMPLATES, ...userTemplates];
}

/** Find a template by ID (built-in first, then user). */
function findTemplate(projectDir: string, id: string): WorkflowTemplateData | null {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === id);
  if (builtIn) return builtIn;
  const user = loadUserTemplates(projectDir);
  return user.find((t) => t.id === id) ?? null;
}

/**
 * Every writable key/value pair a template overlay would set, flattened to the
 * dotted paths the config gate speaks (`retry.maxRetries`, `guard.blockedPaths`).
 *
 * `guard` and `retry` are merged a level down by {@link mergeTemplateConfig},
 * so their members are validated individually; everything else is a top-level
 * assignment.
 */
function flattenTemplateOverlay(overlay: Record<string, unknown>): Array<[string, unknown]> {
  const pairs: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(overlay)) {
    if ((key === "guard" || key === "retry") && isRecord(value)) {
      for (const [inner, innerValue] of Object.entries(value)) {
        pairs.push([`${key}.${inner}`, innerValue]);
      }
      continue;
    }
    pairs.push([key, value]);
  }
  return pairs;
}

/**
 * Refuse a template overlay that would write a config field the dashboard may
 * not write. Returns the first problem, or null.
 *
 * Templates are the fourth path into `.hench/config.json`, after the config
 * editor, the adaptive routes and the workflow apply — and the only one that
 * used to skip the gate those three share. `POST /api/hench/templates` takes
 * `config` verbatim from the request body and `…/apply` merges it into the
 * file, so an unvalidated overlay could invent `permissionMode`, reshape
 * `guard.allowedCommands`, or walk `__proto__` — precisely the three threats
 * `hench-config-fields.ts` names — and the next autonomous run inherited it.
 */
export function validateTemplateOverlay(overlay: Record<string, unknown>): string | null {
  for (const [key, value] of flattenTemplateOverlay(overlay)) {
    const problem = validateConfigKeyValue(key, value);
    if (problem) return problem;
  }
  return null;
}

/** Apply a template config overlay to a config object. */
function mergeTemplateConfig(
  config: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "guard" || key === "retry") {
      // Deep merge nested objects
      const existing = (result[key] ?? {}) as Record<string, unknown>;
      result[key] = { ...existing, ...(value as Record<string, unknown>) };
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Template route handlers ──────────────────────────────────────────

/** GET /api/hench/templates */
export function handleTemplateList(
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const templates = getAllTemplates(ctx.projectDir);
  jsonResponse(res, 200, { templates });
  return true;
}

/** GET /api/hench/templates/:id */
export function handleTemplateGet(
  id: string,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const template = findTemplate(ctx.projectDir, id);
  if (!template) {
    errorResponse(res, 404, `Template "${id}" not found`);
    return true;
  }
  jsonResponse(res, 200, template);
  return true;
}

/** POST /api/hench/templates — create/update user template. */
export async function handleTemplateCreate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const body = await readJsonBody(req, res);
  if (body === undefined) return true;

  const id = body.id as string | undefined;
  if (!id || typeof id !== "string" || !/^[a-z][a-z0-9-]{1,49}$/.test(id)) {
    errorResponse(res, 400, "Template ID is required and must be lowercase with hyphens (2-50 chars)");
    return true;
  }

  // Reject overwriting built-in templates
  if (BUILT_IN_TEMPLATES.some((t) => t.id === id)) {
    errorResponse(res, 400, `Cannot overwrite built-in template "${id}"`);
    return true;
  }

  const rawOverlay = (body.config as Record<string, unknown>) || {};
  if (!rawOverlay || typeof rawOverlay !== "object" || Array.isArray(rawOverlay)) {
    errorResponse(res, 400, "Template config must be an object");
    return true;
  }
  // The settings page saves the GET config as the overlay, and that carries
  // the user's `HENCH_LOCAL_ONLY_SETTINGS` from .n-dx.local.json. Applying the
  // template would write them into .hench/config.json, where the trust review
  // reads them as the repository's and the checkout turns untrusted.
  const overlay = Object.fromEntries(
    Object.entries(rawOverlay).filter(([key]) => !isHenchLocalOnlySetting(key)),
  );
  const overlayProblem = validateTemplateOverlay(overlay);
  if (overlayProblem) {
    errorResponse(res, 400, overlayProblem);
    return true;
  }

  const template: WorkflowTemplateData = {
    id,
    name: (body.name as string) || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: (body.description as string) || "User-defined workflow template",
    useCases: Array.isArray(body.useCases) ? body.useCases as string[] : [],
    tags: Array.isArray(body.tags) ? body.tags as string[] : [],
    config: overlay,
    builtIn: false,
    createdAt: new Date().toISOString(),
  };

  // Load, update, and write back
  const filePath = join(henchDirIn(ctx.projectDir), TEMPLATES_FILE);
  const existing = loadUserTemplates(ctx.projectDir);
  const idx = existing.findIndex((t) => t.id === id);
  if (idx >= 0) {
    existing[idx] = template;
  } else {
    existing.push(template);
  }

  try {
    await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to save template: ${errorMessage(err)}`);
    return true;
  }

  jsonResponse(res, 201, template);
  return true;
}

/** POST /api/hench/templates/:id/apply — apply template to current config. */
export async function handleTemplateApply(
  id: string,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const template = findTemplate(ctx.projectDir, id);
  if (!template) {
    errorResponse(res, 404, `Template "${id}" not found`);
    return true;
  }

  // Re-validated on the way out, not just on the way in: `.hench/templates.json`
  // is a file, and one written before this gate existed (or by hand) must not
  // become a config write just because it is already stored.
  const overlayProblem = validateTemplateOverlay(template.config);
  if (overlayProblem) {
    errorResponse(res, 400, `Template "${id}" cannot be applied: ${overlayProblem}`);
    return true;
  }

  const config = loadHenchConfig(ctx.projectDir);
  if (!config) {
    errorResponse(res, 404, "Hench configuration not found. Run 'hench init' first.");
    return true;
  }

  const updated = mergeTemplateConfig(config, template.config);
  // A template overlay carrying part of a nested group (or merging into a
  // config that never had it) must not leave a partial group on disk.
  completeConfigGroups(updated);

  const constraintProblem = validateConfigConstraints(updated);
  if (constraintProblem) {
    errorResponse(res, 400, `Template "${id}" cannot be applied: ${constraintProblem}`);
    return true;
  }
  const configPath = henchConfigPath(ctx.projectDir);

  try {
    writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to write config: ${errorMessage(err)}`);
    return true;
  }

  // Fail-forward commits the change; a no-op when the mode is off.
  await commitSettingsChange(ctx.projectDir, configPath, "hench");

  jsonResponse(res, 200, {
    applied: template.id,
    templateName: template.name,
    config: updated,
  });
  return true;
}

/** DELETE /api/hench/templates/:id — delete user template. */
export async function handleTemplateDelete(
  id: string,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  if (BUILT_IN_TEMPLATES.some((t) => t.id === id)) {
    errorResponse(res, 400, `Cannot delete built-in template "${id}"`);
    return true;
  }

  const filePath = join(henchDirIn(ctx.projectDir), TEMPLATES_FILE);
  const existing = loadUserTemplates(ctx.projectDir);
  const filtered = existing.filter((t) => t.id !== id);

  if (filtered.length === existing.length) {
    errorResponse(res, 404, `Template "${id}" not found`);
    return true;
  }

  try {
    await writeFile(filePath, JSON.stringify(filtered, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to delete template: ${errorMessage(err)}`);
    return true;
  }

  jsonResponse(res, 200, { deleted: id });
  return true;
}
