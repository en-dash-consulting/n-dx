import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";
import { parseDocument } from "../../src/store/markdown-parser.js";
import { titleToFilename } from "../../src/store/title-to-filename.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

/**
 * Write a test PRD by creating the folder tree structure synchronously.
 * This uses simple directory and file creation without going through the async serializer.
 *
 * The per-item markdown file is written to `<titleToFilename(title)>.md`, matching
 * what the production serializer produces. The folder-tree parser also accepts an
 * `index.md` fallback, so older fixtures that hand-wrote `index.md` still parse.
 *
 * The full document is also persisted to `.rex/prd.json` so that any test PRD the
 * folder tree cannot represent (e.g., a non-epic item at the root, used to exercise
 * orphan/structural validation) is still loadable via the FileStore legacy fallback.
 */
export function writePRD(dir: string, doc: PRDDocument): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });

  // Write tree-meta.json with the document title
  writeFileSync(
    join(dir, ".rex", "tree-meta.json"),
    JSON.stringify({ title: doc.title }),
  );

  // Persist the full document for the legacy read fallback. This is the only
  // surface that round-trips items the folder tree cannot express (non-epic
  // root items, etc.) and keeps test setup decoupled from slug shape.
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc, null, 2));

  // Reset the tree so successive writePRD calls in the same temp dir do not
  // leak items from a previous run.
  const treePath = join(dir, ".rex", PRD_TREE_DIRNAME);
  if (existsSync(treePath)) rmSync(treePath, { recursive: true, force: true });
  // prd.md is the legacy fallback's write target; clear it so the next CLI
  // load re-materializes from the freshly written prd.json.
  const prdMdPath = join(dir, ".rex", "prd.md");
  if (existsSync(prdMdPath)) rmSync(prdMdPath, { force: true });

  // Skip tree creation entirely if the document has any non-epic items at the
  // root. Such PRDs are intentionally malformed (used to exercise structural
  // validation) and would partially populate the tree, causing FileStore to
  // pick tree-only items and silently drop the orphans.
  const allRootItemsAreEpics = doc.items.every((i) => i.level === "epic");
  if (!allRootItemsAreEpics) return;

  // Skip tree creation when the document has duplicate IDs. The tree maps
  // each id to a directory, so siblings with the same id collide and the
  // duplicate signal is lost. validate.test.ts relies on this case via the
  // legacy prd.json fallback to verify the duplicate-detection error path.
  const collectAllIds = (items: PRDItem[]): string[] =>
    items.flatMap((i) => [i.id, ...collectAllIds(i.children ?? [])]);
  const allIds = collectAllIds(doc.items);
  if (new Set(allIds).size !== allIds.length) return;

  // Create minimal folder tree structure for tests
  mkdirSync(join(dir, ".rex", PRD_TREE_DIRNAME), { recursive: true });

  const writeItem = (itemDir: string, item: PRDItem): void => {
    mkdirSync(itemDir, { recursive: true });
    writeFileSync(join(itemDir, titleToFilename(item.title)), createMinimalMarkdown(item));
  };

  // Write each epic as a directory with a title-named markdown file
  for (const epic of doc.items) {
    if (epic.level !== "epic") continue;
    const epicDir = join(dir, ".rex", PRD_TREE_DIRNAME, epic.id);
    writeItem(epicDir, epic);

    // Write features
    for (const feature of epic.children || []) {
      if (feature.level !== "feature") continue;
      const featureDir = join(epicDir, feature.id);
      writeItem(featureDir, feature);

      // Write tasks
      for (const task of feature.children || []) {
        if (task.level !== "task") continue;
        const taskDir = join(featureDir, task.id);
        writeItem(taskDir, task);

        for (const subtask of task.children || []) {
          if (subtask.level !== "subtask") continue;
          writeItem(join(taskDir, subtask.id), subtask);
        }
      }
    }

    // Also handle tasks directly under epics
    for (const task of epic.children || []) {
      if (task.level !== "task") continue;
      const taskDir = join(epicDir, task.id);
      writeItem(taskDir, task);

      for (const subtask of task.children || []) {
        if (subtask.level !== "subtask") continue;
        writeItem(join(taskDir, subtask.id), subtask);
      }
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
 * Read the PRD document from the folder tree, with a legacy fallback.
 *
 * The CLI only persists mutations to the folder tree, so the tree is the
 * authoritative post-mutation source. This sync reader uses a permissive
 * frontmatter parser that preserves every field (including `source`, `tags`,
 * `acceptanceCriteria`, etc.) so tests can assert on the full item shape.
 *
 * If the tree directory does not exist (e.g., the test PRD was malformed and
 * writePRD declined to create one), falls back to reading the legacy
 * `.rex/prd.json` source.
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

  const treeRoot = join(dir, ".rex", PRD_TREE_DIRNAME);
  if (!existsSync(treeRoot)) {
    try {
      const raw = readFileSync(join(dir, ".rex", "prd.json"), "utf-8");
      const doc = JSON.parse(raw) as PRDDocument;
      return { ...doc, title: doc.title ?? title };
    } catch {
      return { schema: "rex/v1", title, items: [] };
    }
  }

  const items = readFolderTreeSync(treeRoot);
  return {
    schema: "rex/v1",
    title,
    items,
  };
}

/**
 * Synchronous folder-tree parser for test support.
 * Mirrors the async parseFolderTree (folder-tree-parser.ts) including
 * single-child compaction reconstruction via `__parent*` frontmatter fields.
 */
function readFolderTreeSync(treeRoot: string): PRDItem[] {
  const items: PRDItem[] = [];
  for (const childDirName of listSubdirNames(treeRoot)) {
    const item = parseDirRecursiveSync(join(treeRoot, childDirName));
    if (item) items.push(item);
  }
  return items;
}

function parseDirRecursiveSync(dir: string): PRDItem | null {
  const itemPath = discoverItemFile(dir);
  if (!itemPath) return null;
  const item = parseItemFromMarkdown(readFileSync(itemPath, "utf-8")) as PRDItem | null;
  if (!item) return null;

  // Single-child compaction: this item itself was flattened into its grandparent's
  // directory and carries `__parentId` etc. Reconstruct the parent chain and use
  // this item's subdirectories as the (deepest) item's own children.
  if ((item as Record<string, unknown>).__parentId !== undefined) {
    const directParent = reconstructParentFromChild(item);
    cleanupParentMetadata(item);
    if (directParent) {
      const childItems: PRDItem[] = [];
      for (const childDirName of listSubdirNames(dir)) {
        const child = parseDirRecursiveSync(join(dir, childDirName));
        if (child) childItems.push(child);
      }
      if (childItems.length > 0) item.children = childItems;
      directParent.children = [item];

      // Walk further up if the reconstructed parent itself carried ancestor
      // fields (deeply nested single-child compaction).
      let ancestor: PRDItem = directParent;
      while ((ancestor as Record<string, unknown>).__parentId !== undefined) {
        const grandparent = reconstructParentFromChild(ancestor);
        cleanupParentMetadata(ancestor);
        if (!grandparent) break;
        grandparent.children = [ancestor];
        ancestor = grandparent;
      }
      return ancestor;
    }
  }

  // Otherwise look for compacted siblings: orphaned `.md` files in this directory
  // whose frontmatter carries `__parentId`. Each such file represents a feature
  // (or lower) whose own directory was elided because it had a single child.
  const orphans = findOrphanedChildrenInDir(dir, itemPath);
  const childItems: PRDItem[] = [];
  const reconstructedParents = new Map<string, PRDItem>();
  for (const orphan of orphans) {
    const directParent = reconstructParentFromChild(orphan);
    cleanupParentMetadata(orphan);
    if (!directParent) continue;
    // The orphan may itself need its own subdirectories as children — but
    // because the orphan lives at parent-dir level, it has no subdirectory of
    // its own. (Its grand-children, if any, sit under sibling subdirs of its
    // own directory tree, which is unreachable here.) For test fixture
    // purposes the production case we care about is the leaf orphan: a task
    // whose feature was compacted. Subdirectories of this orphan don't exist
    // on disk, so we leave its `children` undefined.

    // Walk further up if the parent itself carries ancestor fields.
    let topAncestor: PRDItem = directParent;
    while ((topAncestor as Record<string, unknown>).__parentId !== undefined) {
      const grandparent = reconstructParentFromChild(topAncestor);
      cleanupParentMetadata(topAncestor);
      if (!grandparent) break;
      grandparent.children = [topAncestor];
      topAncestor = grandparent;
    }

    // Coalesce orphans that share a parent id (e.g. multiple compacted siblings
    // pointing back at the same feature) into one reconstructed parent.
    const existing = reconstructedParents.get(directParent.id);
    if (existing) {
      existing.children = [...(existing.children ?? []), orphan];
    } else {
      directParent.children = [orphan];
      reconstructedParents.set(directParent.id, directParent);
      childItems.push(topAncestor);
    }
  }

  // Walk regular subdirectories.
  for (const childDirName of listSubdirNames(dir)) {
    const child = parseDirRecursiveSync(join(dir, childDirName));
    if (child) childItems.push(child);
  }

  if (childItems.length > 0) item.children = childItems;
  return item;
}

function findOrphanedChildrenInDir(dir: string, itemFile: string): PRDItem[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const orphans: PRDItem[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry === "index.md") continue;
    const path = join(dir, entry);
    if (path === itemFile) continue;
    const parsed = parseItemFromMarkdown(readFileSync(path, "utf-8")) as PRDItem | null;
    if (!parsed) continue;
    if ((parsed as Record<string, unknown>).__parentId === undefined) continue;
    orphans.push(parsed);
  }
  return orphans;
}

function reconstructParentFromChild(child: PRDItem): PRDItem | null {
  const r = child as Record<string, unknown>;
  const id = r.__parentId as string | undefined;
  const title = r.__parentTitle as string | undefined;
  const level = r.__parentLevel as string | undefined;
  const status = r.__parentStatus as string | undefined;
  if (!id || !title || !level || !status) return null;

  const parent: PRDItem = { id, title, level: level as PRDItem["level"], status: status as PRDItem["status"] };
  const optionalFields: Array<[string, keyof PRDItem | string]> = [
    ["__parentDescription", "description"],
    ["__parentPriority", "priority"],
    ["__parentTags", "tags"],
    ["__parentBlockedBy", "blockedBy"],
    ["__parentSource", "source"],
    ["__parentStartedAt", "startedAt"],
    ["__parentCompletedAt", "completedAt"],
    ["__parentEndedAt", "endedAt"],
    ["__parentResolutionType", "resolutionType"],
    ["__parentResolutionDetail", "resolutionDetail"],
    ["__parentFailureReason", "failureReason"],
    ["__parentAcceptanceCriteria", "acceptanceCriteria"],
    ["__parentLoe", "loe"],
  ];
  for (const [src, dst] of optionalFields) {
    if (r[src] !== undefined) {
      (parent as Record<string, unknown>)[dst] = r[src];
    }
  }
  // Forward any `__parent__parent*` ancestor fields onto the reconstructed
  // parent (stripping one __parent prefix) so the chain walk can continue.
  for (const [k, v] of Object.entries(r)) {
    if (k.startsWith("__parent__parent")) {
      (parent as Record<string, unknown>)[k.slice("__parent".length)] = v;
    }
  }
  return parent;
}

function cleanupParentMetadata(item: PRDItem): void {
  const r = item as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (k.startsWith("__parent")) delete r[k];
  }
}

function listSubdirNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry: string) => {
      try {
        return statSync(join(dir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Find the item markdown file inside `dir` using the same discovery rule as the
 * production parser: if exactly one non-`index.md` markdown file exists, use it;
 * otherwise fall back to `index.md`. Returns null if neither exists.
 */
function discoverItemFile(dir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const titleNamed = entries.filter((f) => f.endsWith(".md") && f !== "index.md");
  if (titleNamed.length === 1) return join(dir, titleNamed[0]);
  const indexPath = join(dir, "index.md");
  if (existsSync(indexPath)) return indexPath;
  return null;
}

/**
 * Parse a single item from its markdown frontmatter.
 *
 * Preserves every scalar and inline-array field so tests can assert on the
 * full item shape without losing metadata like `source`, `tags`, `loe`, or
 * `acceptanceCriteria`. Unknown fields are kept as-is on the returned object.
 */
function parseItemFromMarkdown(content: string): Partial<PRDItem> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const item: Record<string, unknown> = {};
  const lines = frontmatter.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (!key) continue;

    // Block-style YAML list: `key:` followed by `  - "item"` lines.
    if (!rawValue) {
      const arr: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s/.test(lines[j])) {
        arr.push(parseScalar(lines[j].replace(/^\s+-\s+/, "")));
        j++;
      }
      if (arr.length > 0) {
        item[key] = arr;
        i = j - 1;
      }
      continue;
    }

    // Inline array: `key: ["a", "b"]`.
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      try {
        item[key] = JSON.parse(rawValue);
        continue;
      } catch {
        // fall through to scalar handling
      }
    }

    item[key] = parseScalar(rawValue);
  }

  return item.title ? (item as Partial<PRDItem>) : null;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  // The serializer emits values via JSON.stringify, so unescape via JSON.parse
  // when the value is double-quoted. This recovers \n, \t, \", etc.
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function writeConfig<T extends Record<string, unknown>>(dir: string, config: T): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}
