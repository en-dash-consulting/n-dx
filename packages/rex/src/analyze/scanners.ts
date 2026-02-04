import { readFile, readdir, access } from "node:fs/promises";
import { join, relative, dirname, basename, extname } from "node:path";
import type { Priority } from "../schema/index.js";

export interface ScanResult {
  name: string;
  source: "test" | "doc" | "sourcevision";
  sourceFile: string;
  kind: "epic" | "feature" | "task";
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
}

export interface ScanOptions {
  lite?: boolean;
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".rex",
  ".git",
  ".sourcevision",
  "coverage",
  ".next",
  ".turbo",
]);

async function globFiles(
  dir: string,
  match: (rel: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const rel = relative(dir, join(current, entry.name));
        if (match(rel)) {
          results.push(join(current, entry.name));
        }
      }
    }
  }

  await walk(dir);
  return results;
}

function isTestFile(rel: string): boolean {
  if (rel.includes("__tests__/")) return true;
  const base = basename(rel);
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(base);
}

function toTitleCase(str: string): string {
  return str
    .replace(/[-_./]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function inferEpicName(filePath: string, baseDir: string): string {
  const rel = relative(baseDir, filePath);
  const parts = dirname(rel).split("/").filter((p) => p !== "." && p !== "");
  // Skip common test root directories
  const meaningful = parts.filter(
    (p) =>
      !["tests", "test", "__tests__", "unit", "integration", "e2e", "spec"].includes(p),
  );
  if (meaningful.length > 0) {
    return toTitleCase(meaningful[0]);
  }
  return "General";
}

function featureNameFromFile(filePath: string): string {
  const base = basename(filePath);
  const name = base
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "");
  return toTitleCase(name);
}

export async function scanTests(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const files = await globFiles(dir, isTestFile);
  const results: ScanResult[] = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    const epicName = inferEpicName(filePath, dir);
    const featureName = featureNameFromFile(filePath);

    // Always emit a feature-level result for the file itself
    results.push({
      name: featureName,
      source: "test",
      sourceFile: rel,
      kind: "feature",
      tags: [epicName],
    });

    if (opts.lite) continue;

    // Full mode: parse file contents
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // Extract describe blocks (top-level → feature-level context)
    const describeRegex = /describe\(\s*["'`]([^"'`]+)["'`]/g;
    let descMatch: RegExpExecArray | null;
    while ((descMatch = describeRegex.exec(content)) !== null) {
      const descName = descMatch[1];
      // Skip if it's just the same as the file name
      if (descName.toLowerCase() === featureName.toLowerCase()) continue;
      results.push({
        name: descName,
        source: "test",
        sourceFile: rel,
        kind: "feature",
        tags: [epicName],
      });
    }

    // Extract it/test blocks → tasks
    const itRegex = /(?:it|test)\(\s*["'`]([^"'`]+)["'`]/g;
    let itMatch: RegExpExecArray | null;
    while ((itMatch = itRegex.exec(content)) !== null) {
      results.push({
        name: itMatch[1],
        source: "test",
        sourceFile: rel,
        kind: "task",
        acceptanceCriteria: [itMatch[1]],
        tags: [epicName],
      });
    }
  }

  return results;
}

function isDocFile(rel: string): boolean {
  const ext = extname(rel).toLowerCase();
  return [".md", ".txt", ".json", ".yaml", ".yml"].includes(ext);
}

function extractMarkdownHeadings(
  content: string,
): { heading: string; bullets: string[] }[] {
  const lines = content.split("\n");
  const sections: { heading: string; bullets: string[] }[] = [];
  let current: { heading: string; bullets: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].trim(), bullets: [] };
      continue;
    }
    if (current) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
      if (bulletMatch) {
        current.bullets.push(bulletMatch[1].trim());
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractJsonItems(
  content: string,
): { name: string; description?: string }[] {
  try {
    const data = JSON.parse(content);
    const items: { name: string; description?: string }[] = [];

    function scan(obj: unknown): void {
      if (Array.isArray(obj)) {
        for (const el of obj) scan(el);
      } else if (obj && typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        const name = (o.title ?? o.name) as string | undefined;
        if (typeof name === "string") {
          items.push({
            name,
            description: typeof o.description === "string" ? o.description : undefined,
          });
        }
        for (const val of Object.values(o)) {
          if (typeof val === "object" && val !== null) scan(val);
        }
      }
    }

    scan(data);
    return items;
  } catch {
    return [];
  }
}

function extractYamlItems(
  content: string,
): { name: string; description?: string }[] {
  // Simple YAML extraction: look for title/name fields
  const items: { name: string; description?: string }[] = [];
  const lines = content.split("\n");
  let currentName: string | null = null;
  let currentDesc: string | null = null;

  for (const line of lines) {
    const nameMatch = line.match(/^\s*(?:title|name)\s*:\s*["']?(.+?)["']?\s*$/);
    if (nameMatch) {
      if (currentName) {
        items.push({
          name: currentName,
          description: currentDesc ?? undefined,
        });
      }
      currentName = nameMatch[1];
      currentDesc = null;
      continue;
    }
    const descMatch = line.match(/^\s*description\s*:\s*["']?(.+?)["']?\s*$/);
    if (descMatch && currentName) {
      currentDesc = descMatch[1];
    }
  }
  if (currentName) {
    items.push({
      name: currentName,
      description: currentDesc ?? undefined,
    });
  }
  return items;
}

export async function scanDocs(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const files = await globFiles(dir, isDocFile);
  const results: ScanResult[] = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    const ext = extname(filePath).toLowerCase();

    if (opts.lite) {
      // Lite mode: just use filename as a feature name
      const name = basename(filePath, ext);
      if (name.toLowerCase() === "readme" || name.toLowerCase() === "changelog") continue;
      results.push({
        name: toTitleCase(name),
        source: "doc",
        sourceFile: rel,
        kind: "feature",
      });
      continue;
    }

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    if (ext === ".md" || ext === ".txt") {
      const sections = extractMarkdownHeadings(content);
      for (const section of sections) {
        results.push({
          name: section.heading,
          source: "doc",
          sourceFile: rel,
          kind: "feature",
          acceptanceCriteria:
            section.bullets.length > 0 ? section.bullets : undefined,
        });
        for (const bullet of section.bullets) {
          results.push({
            name: bullet,
            source: "doc",
            sourceFile: rel,
            kind: "task",
          });
        }
      }
    } else if (ext === ".json") {
      const items = extractJsonItems(content);
      for (const item of items) {
        results.push({
          name: item.name,
          source: "doc",
          sourceFile: rel,
          kind: "feature",
          description: item.description,
        });
      }
    } else if (ext === ".yaml" || ext === ".yml") {
      const items = extractYamlItems(content);
      for (const item of items) {
        results.push({
          name: item.name,
          source: "doc",
          sourceFile: rel,
          kind: "feature",
          description: item.description,
        });
      }
    }
  }

  return results;
}

// Canonical sourcevision schema (v1)
interface SVFinding {
  type: "observation" | "pattern" | "relationship" | "anti-pattern" | "suggestion";
  pass: number;
  scope: string;
  text: string;
  severity?: "info" | "warning" | "critical";
  related?: string[];
}

interface SVZone {
  id: string;
  name: string;
  description: string;
  files: string[];
  entryPoints: string[];
  cohesion: number;
  coupling: number;
  insights?: string[];
}

interface SVZonesData {
  zones: SVZone[];
  findings?: SVFinding[];
  insights?: string[];
}

// Legacy zone format (pre-v1)
interface LegacyZone {
  name: string;
  description?: string;
  insights?: string[];
  findings?: {
    severity: string;
    message: string;
    file?: string;
  }[];
}

// Canonical inventory schema
interface SVFileEntry {
  path: string;
  category: string;
  role: string;
}

interface SVInventoryData {
  files?: SVFileEntry[];
  // Legacy format
  byCategory?: Record<string, unknown>;
}

// Canonical imports schema
interface SVCircularDependency {
  cycle: string[];
}

interface SVImportsData {
  summary?: {
    circulars?: SVCircularDependency[];
  };
  // Legacy formats
  circularDependencies?: { from: string; to: string }[];
  circular?: string[][];
}

/** Map finding type to an actionable task prefix */
function findingPrefix(type: SVFinding["type"]): string {
  switch (type) {
    case "anti-pattern":
      return "Fix";
    case "suggestion":
      return "Implement";
    case "pattern":
      return "Refactor";
    case "observation":
    case "relationship":
    default:
      return "Investigate";
  }
}

export async function scanSourceVision(dir: string): Promise<ScanResult[]> {
  const svDir = join(dir, ".sourcevision");
  try {
    await access(svDir);
  } catch {
    return [];
  }

  const results: ScanResult[] = [];

  // Read zones.json — supports both canonical (v1) and legacy formats
  try {
    const raw = await readFile(join(svDir, "zones.json"), "utf-8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      // Legacy format: flat array of zones with inline findings
      processLegacyZones(parsed as LegacyZone[], results);
    } else {
      // Canonical format: { zones, findings, ... }
      const zonesData = parsed as SVZonesData;
      const zones = zonesData.zones ?? [];
      const zoneMap = new Map<string, SVZone>();

      for (const zone of zones) {
        zoneMap.set(zone.id, zone);
        const fileCount = zone.files?.length ?? 0;
        results.push({
          name: zone.name,
          source: "sourcevision",
          sourceFile: ".sourcevision/zones.json",
          kind: "feature",
          description: fileCount > 0
            ? `${zone.description} (${fileCount} files)`
            : zone.description,
          acceptanceCriteria: zone.insights,
        });
      }

      // Process top-level findings into actionable tasks
      if (zonesData.findings) {
        for (const finding of zonesData.findings) {
          // Skip findings with no severity — not yet triaged
          if (!finding.severity) continue;
          // Skip info-level observations/relationships — purely informational
          const infoOnly = finding.type === "observation" || finding.type === "relationship";
          if (finding.severity === "info" && infoOnly) continue;

          const priority: Priority =
            finding.severity === "critical"
              ? "critical"
              : finding.severity === "warning"
                ? "high"
                : "medium";

          const prefix = findingPrefix(finding.type);
          const zone = zoneMap.get(finding.scope);

          // Use first related file as sourceFile, fall back to zones.json
          const primaryFile = finding.related?.[0];
          const sourceFile = primaryFile ?? ".sourcevision/zones.json";

          // Build acceptance criteria from related file paths
          const criteria: string[] = [];
          if (finding.related && finding.related.length > 0) {
            criteria.push(
              `Affected files: ${finding.related.join(", ")}`,
            );
          }
          if (zone) {
            criteria.push(`Zone: ${zone.name} (${zone.files.length} files)`);
          }

          results.push({
            name: `${prefix}: ${finding.text}`,
            source: "sourcevision",
            sourceFile,
            kind: "task",
            priority,
            tags: zone ? [zone.name] : finding.scope !== "global" ? [finding.scope] : undefined,
            acceptanceCriteria: criteria.length > 0 ? criteria : undefined,
          });
        }
      }
    }
  } catch {
    // zones.json not found or invalid, skip
  }

  // Read inventory.json for epic groupings — supports canonical and legacy formats
  try {
    const raw = await readFile(join(svDir, "inventory.json"), "utf-8");
    const inventory: SVInventoryData = JSON.parse(raw);

    if (inventory.files && inventory.files.length > 0) {
      // Canonical format: group files by category
      const categoryFiles = new Map<string, string[]>();
      for (const entry of inventory.files) {
        if (!entry.category) continue;
        const list = categoryFiles.get(entry.category) ?? [];
        list.push(entry.path);
        categoryFiles.set(entry.category, list);
      }
      for (const [category, files] of categoryFiles) {
        const fileLabel = files.length === 1 ? "1 file" : `${files.length} files`;
        results.push({
          name: toTitleCase(category),
          source: "sourcevision",
          sourceFile: ".sourcevision/inventory.json",
          kind: "epic",
          description: `${toTitleCase(category)} (${fileLabel})`,
        });
      }
    } else if (inventory.byCategory) {
      // Legacy format: byCategory object
      for (const category of Object.keys(inventory.byCategory)) {
        results.push({
          name: toTitleCase(category),
          source: "sourcevision",
          sourceFile: ".sourcevision/inventory.json",
          kind: "epic",
        });
      }
    }
  } catch {
    // inventory.json not found or invalid, skip
  }

  // Read imports.json for circular dependencies — supports canonical and legacy formats
  try {
    const raw = await readFile(join(svDir, "imports.json"), "utf-8");
    const imports: SVImportsData = JSON.parse(raw);

    // Canonical format: summary.circulars[].cycle
    if (imports.summary?.circulars) {
      for (const dep of imports.summary.circulars) {
        const uniqueFiles = [...new Set(dep.cycle)];
        const label = uniqueFiles.join(" → ");
        results.push({
          name: `Resolve circular: ${label}`,
          source: "sourcevision",
          sourceFile: uniqueFiles[0] ?? ".sourcevision/imports.json",
          kind: "task",
          priority: "high",
          tags: ["tech-debt"],
          acceptanceCriteria: [
            `Break circular dependency cycle: ${dep.cycle.join(" → ")}`,
            ...uniqueFiles.map((f) => `File: ${f}`),
          ],
        });
      }
    }

    // Legacy format: circularDependencies[].{from, to}
    if (imports.circularDependencies) {
      for (const dep of imports.circularDependencies) {
        results.push({
          name: `Resolve circular: ${dep.from} → ${dep.to}`,
          source: "sourcevision",
          sourceFile: ".sourcevision/imports.json",
          kind: "task",
          priority: "high",
          tags: ["tech-debt"],
        });
      }
    }

    // Legacy format: circular[][]
    if (imports.circular) {
      for (const cycle of imports.circular) {
        const label = cycle.join(" → ");
        results.push({
          name: `Resolve circular: ${label}`,
          source: "sourcevision",
          sourceFile: ".sourcevision/imports.json",
          kind: "task",
          priority: "high",
          tags: ["tech-debt"],
        });
      }
    }
  } catch {
    // imports.json not found or invalid, skip
  }

  return results;
}

/** Process legacy zone format (flat array with inline findings) */
function processLegacyZones(
  zones: LegacyZone[],
  results: ScanResult[],
): void {
  for (const zone of zones) {
    results.push({
      name: zone.name,
      source: "sourcevision",
      sourceFile: ".sourcevision/zones.json",
      kind: "feature",
      description: zone.description,
      acceptanceCriteria: zone.insights,
    });

    if (zone.findings) {
      for (const finding of zone.findings) {
        const priority: Priority =
          finding.severity === "critical"
            ? "critical"
            : finding.severity === "warning"
              ? "high"
              : "medium";
        results.push({
          name: finding.message,
          source: "sourcevision",
          sourceFile: finding.file ?? ".sourcevision/zones.json",
          kind: "task",
          priority,
          tags: [zone.name],
        });
      }
    }
  }
}
