/**
 * hench template — workflow template management.
 *
 * Subcommands:
 *   hench template list [dir]                — list all available templates
 *   hench template show <id> [dir]           — show template details
 *   hench template apply <id> [dir]          — apply a template to current config
 *   hench template save <id> [--name=...] [--description=...] [dir]
 *                                             — save current config as a user template
 *   hench template delete <id> [dir]         — delete a user-defined template
 */

import { join } from "node:path";
import { loadConfig, saveConfig } from "../../store/config.js";
import { validateConfig, formatValidationErrors } from "../../schema/index.js";
import {
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  applyTemplate,
  isValidTemplateId,
} from "../../store/templates.js";
import type { WorkflowTemplate } from "../../schema/templates.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

// ── Display helpers ──────────────────────────────────────────────────

function formatTemplateList(templates: WorkflowTemplate[], format: string): string {
  if (format === "json") {
    return JSON.stringify(templates, null, 2);
  }

  const lines: string[] = [];
  lines.push("\n  Available Workflow Templates");
  lines.push(`  ${"═".repeat(50)}`);

  const builtIn = templates.filter((t) => t.builtIn);
  const user = templates.filter((t) => !t.builtIn);

  if (builtIn.length > 0) {
    lines.push("\n  Built-in:");
    for (const t of builtIn) {
      lines.push(`    ${t.id.padEnd(22)} ${t.name}`);
      lines.push(`    ${"".padEnd(22)} ${t.description}`);
    }
  }

  if (user.length > 0) {
    lines.push("\n  User-defined:");
    for (const t of user) {
      lines.push(`    ${t.id.padEnd(22)} ${t.name}`);
      lines.push(`    ${"".padEnd(22)} ${t.description}`);
    }
  }

  lines.push("");
  lines.push("  Use 'hench template show <id>' for details.");
  lines.push("  Use 'hench template apply <id>' to apply a template.");
  return lines.join("\n");
}

function formatTemplateDetail(template: WorkflowTemplate, format: string): string {
  if (format === "json") {
    return JSON.stringify(template, null, 2);
  }

  const lines: string[] = [];
  lines.push(`\n  ${template.name}${template.builtIn ? " (built-in)" : ""}`);
  lines.push(`  ${"─".repeat(40)}`);
  lines.push(`  ID:          ${template.id}`);
  lines.push(`  Description: ${template.description}`);

  if (template.tags.length > 0) {
    lines.push(`  Tags:        ${template.tags.join(", ")}`);
  }

  if (template.useCases.length > 0) {
    lines.push("\n  Recommended use cases:");
    for (const uc of template.useCases) {
      lines.push(`    \u2022 ${uc}`);
    }
  }

  lines.push("\n  Config overrides:");
  const configEntries = flattenConfig(template.config);
  const maxKey = Math.max(...configEntries.map(([k]) => k.length));
  for (const [key, value] of configEntries) {
    const formatted = Array.isArray(value) ? value.join(", ") : String(value);
    lines.push(`    ${key.padEnd(maxKey + 2)} ${formatted}`);
  }

  if (template.createdAt) {
    lines.push(`\n  Created: ${template.createdAt}`);
  }

  lines.push("");
  return lines.join("\n");
}

/** Flatten a nested config overlay into dot-path entries. */
function flattenConfig(
  obj: Record<string, unknown>,
  prefix = "",
): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenConfig(value as Record<string, unknown>, path));
    } else {
      entries.push([path, value]);
    }
  }
  return entries;
}

// ── Subcommand handlers ──────────────────────────────────────────────

async function cmdTemplateList(
  henchDir: string,
  format: string,
): Promise<void> {
  const templates = await listTemplates(henchDir);
  const output = formatTemplateList(templates, format);
  if (format === "json") {
    result(output);
  } else {
    info(output);
  }
}

async function cmdTemplateShow(
  henchDir: string,
  id: string,
  format: string,
): Promise<void> {
  const template = await getTemplate(henchDir, id);
  if (!template) {
    throw new CLIError(
      `Template "${id}" not found.`,
      "Use 'hench template list' to see available templates.",
    );
  }
  const output = formatTemplateDetail(template, format);
  if (format === "json") {
    result(output);
  } else {
    info(output);
  }
}

async function cmdTemplateApply(
  henchDir: string,
  id: string,
): Promise<void> {
  const template = await getTemplate(henchDir, id);
  if (!template) {
    throw new CLIError(
      `Template "${id}" not found.`,
      "Use 'hench template list' to see available templates.",
    );
  }

  const config = await loadConfig(henchDir);
  const updated = applyTemplate(config, template.config);

  // Validate before saving
  const validation = validateConfig(updated);
  if (!validation.ok) {
    const errors = formatValidationErrors(validation.errors);
    throw new CLIError(
      `Template produces invalid config: ${errors.join(", ")}`,
      "The template may be incompatible with your current configuration.",
    );
  }

  await saveConfig(henchDir, updated);

  info(`\nApplied template "${template.name}" to .hench/config.json`);

  const entries = flattenConfig(template.config);
  if (entries.length > 0) {
    info("\n  Changes applied:");
    for (const [key, value] of entries) {
      const formatted = Array.isArray(value) ? value.join(", ") : String(value);
      info(`    ${key}: ${formatted}`);
    }
  }
  info("");
}

async function cmdTemplateSave(
  henchDir: string,
  id: string,
  flags: Record<string, string>,
): Promise<void> {
  if (!isValidTemplateId(id)) {
    throw new CLIError(
      `Invalid template ID "${id}".`,
      "IDs must be lowercase, start with a letter, use hyphens, 2-50 characters.",
    );
  }

  const config = await loadConfig(henchDir);

  // Build config overlay (only non-schema fields)
  const { schema: _schema, ...overlay } = config;

  const template: WorkflowTemplate = {
    id,
    name: flags.name ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: flags.description ?? "User-defined workflow template",
    useCases: flags.usecases ? flags.usecases.split(",").map((s) => s.trim()) : [],
    tags: flags.tags ? flags.tags.split(",").map((s) => s.trim()) : [],
    config: overlay,
    builtIn: false,
    createdAt: new Date().toISOString(),
  };

  await saveTemplate(henchDir, template);
  info(`\nSaved current config as template "${template.name}" (${id})`);
  info("Use 'hench template apply " + id + "' to restore this configuration.");
  info("");
}

async function cmdTemplateDelete(
  henchDir: string,
  id: string,
): Promise<void> {
  const deleted = await deleteTemplate(henchDir, id);
  if (!deleted) {
    throw new CLIError(
      `Template "${id}" not found or is a built-in template.`,
      "Only user-defined templates can be deleted.",
    );
  }
  info(`\nDeleted template "${id}".`);
  info("");
}

// ── CLI entry point ─────────────────────────────────────────────────

export async function cmdTemplate(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, ".hench");
  const subcommand = positional[0];
  const format = flags.format ?? "text";

  if (!subcommand || subcommand === "list") {
    await cmdTemplateList(henchDir, format);
    return;
  }

  switch (subcommand) {
    case "show": {
      const id = positional[1];
      if (!id) {
        throw new CLIError(
          "Missing template ID.",
          "Usage: hench template show <id>",
        );
      }
      await cmdTemplateShow(henchDir, id, format);
      break;
    }
    case "apply": {
      const id = positional[1];
      if (!id) {
        throw new CLIError(
          "Missing template ID.",
          "Usage: hench template apply <id>",
        );
      }
      await cmdTemplateApply(henchDir, id);
      break;
    }
    case "save": {
      const id = positional[1];
      if (!id) {
        throw new CLIError(
          "Missing template ID.",
          "Usage: hench template save <id> [--name=... --description=...]",
        );
      }
      await cmdTemplateSave(henchDir, id, flags);
      break;
    }
    case "delete": {
      const id = positional[1];
      if (!id) {
        throw new CLIError(
          "Missing template ID.",
          "Usage: hench template delete <id>",
        );
      }
      await cmdTemplateDelete(henchDir, id);
      break;
    }
    default:
      throw new CLIError(
        `Unknown template subcommand: ${subcommand}`,
        "Valid subcommands: list, show, apply, save, delete",
      );
  }
}
