import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument } from "../../src/schema/index.js";
import { parseDocument } from "../../src/store/markdown-parser.js";

/**
 * Write a test PRD by creating the folder tree structure synchronously.
 * This uses simple directory and file creation without going through the async serializer.
 */
export function writePRD(dir: string, doc: PRDDocument): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });

  // Write tree-meta.json with the document title
  writeFileSync(
    join(dir, ".rex", "tree-meta.json"),
    JSON.stringify({ title: doc.title }),
  );

  // Create minimal folder tree structure for tests
  // This is a simplified sync version that creates the basic directory structure
  mkdirSync(join(dir, ".rex", "tree"), { recursive: true });

  // Write each epic as a directory with an index.md
  for (const epic of doc.items) {
    if (epic.level !== "epic") continue;
    const epicDir = join(dir, ".rex", "tree", epic.id);
    mkdirSync(epicDir, { recursive: true });
    writeFileSync(join(epicDir, "index.md"), createMinimalMarkdown(epic));

    // Write features
    for (const feature of epic.children || []) {
      if (feature.level !== "feature") continue;
      const featureDir = join(epicDir, feature.id);
      mkdirSync(featureDir, { recursive: true });
      writeFileSync(join(featureDir, "index.md"), createMinimalMarkdown(feature));

      // Write tasks
      for (const task of feature.children || []) {
        if (task.level !== "task") continue;
        const taskDir = join(featureDir, task.id);
        mkdirSync(taskDir, { recursive: true });
        writeFileSync(join(taskDir, "index.md"), createMinimalMarkdown(task));
      }
    }

    // Also handle tasks directly under epics
    for (const task of epic.children || []) {
      if (task.level !== "task") continue;
      const taskDir = join(epicDir, task.id);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(join(taskDir, "index.md"), createMinimalMarkdown(task));
    }
  }
}

/**
 * Create a minimal markdown representation of a PRDItem for folder tree tests.
 */
function createMinimalMarkdown(item: any): string {
  const lines: string[] = [
    "---",
    `id: "${item.id}"`,
    `title: "${item.title}"`,
    `level: "${item.level}"`,
    `status: "${item.status}"`,
    `priority: "${item.priority || 'medium'}"`,
  ];

  if (item.description) {
    lines.push(`description: |`);
    lines.push(`  ${item.description}`);
  }

  if (item.startedAt) lines.push(`startedAt: "${item.startedAt}"`);
  if (item.completedAt) lines.push(`completedAt: "${item.completedAt}"`);

  lines.push("---");
  lines.push("");
  lines.push(`# ${item.title}`);

  return lines.join("\n");
}

/**
 * Read the PRD document from `prd.md`. Mirrors the legacy `JSON.parse(readFileSync(prd.json))`
 * pattern used pervasively in tests prior to the markdown-only-writes migration.
 */
export function readPRD(dir: string): PRDDocument {
  const raw = readFileSync(join(dir, ".rex", "prd.md"), "utf-8");
  const result = parseDocument(raw);
  if (!result.ok) {
    throw new Error(`readPRD: failed to parse prd.md: ${result.error.message}`);
  }
  return result.data;
}

export function writeConfig<T extends Record<string, unknown>>(dir: string, config: T): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}
