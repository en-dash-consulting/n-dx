import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";
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
 * Uses YAML frontmatter format expected by the folder-tree-parser.
 */
function createMinimalMarkdown(item: any): string {
  const lines: string[] = ["---"];

  // Core fields in order (matching real serializer)
  lines.push(`id: "${item.id}"`);
  lines.push(`level: "${item.level}"`);
  lines.push(`title: "${item.title}"`);
  lines.push(`status: "${item.status}"`);
  lines.push(`priority: "${item.priority || "medium"}"`);

  // Optional fields
  if (item.description) {
    lines.push(`description: "${item.description}"`);
  }
  if (item.startedAt) {
    lines.push(`startedAt: "${item.startedAt}"`);
  }
  if (item.completedAt) {
    lines.push(`completedAt: "${item.completedAt}"`);
  }

  // Add any other item fields not explicitly handled
  for (const [key, value] of Object.entries(item)) {
    if (
      !["id", "title", "level", "status", "priority", "description", "startedAt", "completedAt", "children"].includes(
        key,
      )
    ) {
      if (value !== null && value !== undefined) {
        lines.push(`${key}: "${String(value)}"`);
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`# ${item.title}`);

  // Add children table if present
  if (item.children && item.children.length > 0) {
    lines.push("");
    lines.push("## Children");
    lines.push("");
    lines.push("| Title | Status |");
    lines.push("|-------|--------|");
    for (const child of item.children) {
      const childPath = `${child.id}/index.md`;
      lines.push(`| [${child.title}](./${childPath}) | ${child.status} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Read the PRD document from the folder-tree backend at `.rex/tree/`.
 * Simple sync implementation for test support (mirrors writePRD structure).
 */
export function readPRD(dir: string): PRDDocument {
  let title = "PRD";
  try {
    const metaPath = join(dir, ".rex", "tree-meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
    if (typeof meta["title"] === "string") title = meta["title"];
  } catch {
    // No tree-meta.json; use default title
  }

  const treeRoot = join(dir, ".rex", "tree");
  const items = readFolderTreeSync(treeRoot);

  return {
    schema: "rex/v1",
    title,
    items,
  };
}

/**
 * Synchronous folder-tree parser for test support.
 * Mirrors the async parseFolderTree but uses readdirSync and readFileSync.
 */
function readFolderTreeSync(treeRoot: string): PRDItem[] {
  const items: PRDItem[] = [];

  // List epics (depth 1)
  const epicDirs = readdirSync(treeRoot).sort();

  for (const epicId of epicDirs) {
    const epicDir = join(treeRoot, epicId);
    const indexPath = join(epicDir, "index.md");

    const epicItem = parseItemFromMarkdown(readFileSync(indexPath, "utf-8"));
    if (!epicItem) continue;

    epicItem.id = epicId;
    epicItem.children = [];

    // List features and tasks (depth 2)
    const childDirs = readdirSync(epicDir).filter((d) => d !== "index.md").sort();

    for (const childId of childDirs) {
      const childPath = join(epicDir, childId, "index.md");
      const childItem = parseItemFromMarkdown(readFileSync(childPath, "utf-8"));
      if (!childItem) continue;

      childItem.id = childId;
      childItem.children = [];

      // List tasks under features (depth 3)
      if (childItem.level === "feature") {
        const taskDirs = readdirSync(join(epicDir, childId))
          .filter((d) => d !== "index.md")
          .sort();

        for (const taskId of taskDirs) {
          const taskPath = join(epicDir, childId, taskId, "index.md");
          const taskItem = parseItemFromMarkdown(readFileSync(taskPath, "utf-8"));
          if (!taskItem) continue;

          taskItem.id = taskId;
          childItem.children!.push(taskItem);
        }
      }

      epicItem.children!.push(childItem);
    }

    items.push(epicItem);
  }

  return items;
}

/**
 * Parse a single item from its markdown frontmatter.
 * Extracts YAML fields and returns a PRDItem.
 */
function parseItemFromMarkdown(content: string): Partial<PRDItem> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const item: Partial<PRDItem> = {};

  // Parse YAML-like frontmatter (simple line-based parsing)
  for (const line of frontmatter.split("\n")) {
    const [key, ...valueParts] = line.split(":").map((s) => s.trim());
    const value = valueParts.join(":").trim();

    if (!key || !value) continue;

    // Remove quotes if present
    const cleanValue = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;

    switch (key) {
      case "id":
        item.id = cleanValue;
        break;
      case "title":
        item.title = cleanValue;
        break;
      case "level":
        item.level = cleanValue as any;
        break;
      case "status":
        item.status = cleanValue as any;
        break;
      case "priority":
        item.priority = cleanValue as any;
        break;
      case "description":
        item.description = cleanValue;
        break;
      case "startedAt":
        item.startedAt = cleanValue;
        break;
      case "completedAt":
        item.completedAt = cleanValue;
        break;
    }
  }

  return item.title ? item : null;
}

export function writeConfig<T extends Record<string, unknown>>(dir: string, config: T): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}
