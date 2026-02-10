/**
 * Workflow template persistence — load, save, list, and delete user-defined
 * templates stored in `.hench/templates.json`.
 *
 * Built-in templates are defined in schema/templates.ts and merged at read time
 * so they always appear in listings but can never be overwritten or deleted.
 */

import { join } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import { BUILT_IN_TEMPLATES } from "../schema/templates.js";
import { toCanonicalJSON } from "./json.js";
import type { WorkflowTemplate, TemplateConfigOverlay } from "../schema/templates.js";
import type { HenchConfig } from "../schema/v1.js";

const TEMPLATES_FILE = "templates.json";

// ── Persistence ──────────────────────────────────────────────────────

/** Load user-defined templates from .hench/templates.json. */
async function loadUserTemplates(henchDir: string): Promise<WorkflowTemplate[]> {
  const filePath = join(henchDir, TEMPLATES_FILE);
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkflowTemplate[];
  } catch {
    return [];
  }
}

/** Write user-defined templates to .hench/templates.json. */
async function saveUserTemplates(
  henchDir: string,
  templates: WorkflowTemplate[],
): Promise<void> {
  const filePath = join(henchDir, TEMPLATES_FILE);
  await writeFile(filePath, toCanonicalJSON(templates), "utf-8");
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * List all templates: built-in first, then user-defined.
 * User templates with IDs that collide with built-in IDs are excluded.
 */
export async function listTemplates(henchDir: string): Promise<WorkflowTemplate[]> {
  const builtInIds = new Set(BUILT_IN_TEMPLATES.map((t) => t.id));
  const userTemplates = await loadUserTemplates(henchDir);
  const filtered = userTemplates.filter((t) => !builtInIds.has(t.id));
  return [...BUILT_IN_TEMPLATES, ...filtered];
}

/** Get a single template by ID (checks built-in first, then user). */
export async function getTemplate(
  henchDir: string,
  id: string,
): Promise<WorkflowTemplate | null> {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === id);
  if (builtIn) return builtIn;

  const userTemplates = await loadUserTemplates(henchDir);
  return userTemplates.find((t) => t.id === id) ?? null;
}

/**
 * Save a user-defined template. Rejects if the ID matches a built-in template.
 * If a user template with the same ID exists, it is overwritten.
 */
export async function saveTemplate(
  henchDir: string,
  template: WorkflowTemplate,
): Promise<void> {
  if (BUILT_IN_TEMPLATES.some((t) => t.id === template.id)) {
    throw new Error(`Cannot overwrite built-in template "${template.id}"`);
  }

  const templates = await loadUserTemplates(henchDir);
  const idx = templates.findIndex((t) => t.id === template.id);

  const saved: WorkflowTemplate = {
    ...template,
    builtIn: false,
    createdAt: template.createdAt ?? new Date().toISOString(),
  };

  if (idx >= 0) {
    templates[idx] = saved;
  } else {
    templates.push(saved);
  }

  await saveUserTemplates(henchDir, templates);
}

/**
 * Delete a user-defined template by ID. Rejects if the ID is a built-in template.
 * Returns true if a template was deleted, false if not found.
 */
export async function deleteTemplate(
  henchDir: string,
  id: string,
): Promise<boolean> {
  if (BUILT_IN_TEMPLATES.some((t) => t.id === id)) {
    throw new Error(`Cannot delete built-in template "${id}"`);
  }

  const templates = await loadUserTemplates(henchDir);
  const before = templates.length;
  const after = templates.filter((t) => t.id !== id);

  if (after.length === before) return false;

  await saveUserTemplates(henchDir, after);
  return true;
}

/**
 * Apply a template's config overlay to an existing HenchConfig.
 * Returns a new config with the template's fields merged in.
 * The `schema` field is preserved from the original config.
 */
export function applyTemplate(
  config: HenchConfig,
  overlay: TemplateConfigOverlay,
): HenchConfig {
  const result = JSON.parse(JSON.stringify(config)) as HenchConfig;

  // Merge top-level scalar fields
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "guard" || key === "retry") continue;
    (result as unknown as Record<string, unknown>)[key] = value;
  }

  // Deep merge guard
  if (overlay.guard) {
    result.guard = { ...result.guard, ...overlay.guard };
  }

  // Deep merge retry
  if (overlay.retry) {
    result.retry = { ...result.retry, ...overlay.retry };
  }

  return result;
}

/** Validate a template ID format (lowercase, hyphens, 2-50 chars). */
export function isValidTemplateId(id: string): boolean {
  return /^[a-z][a-z0-9-]{1,49}$/.test(id);
}
