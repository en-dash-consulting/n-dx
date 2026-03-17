import { readFile, readdir, access } from "node:fs/promises";
import { join, relative, dirname, basename, extname } from "node:path";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import type { Priority } from "../schema/index.js";
import { computeFindingHash, loadAcknowledged, isAcknowledged } from "./acknowledge.js";
import type { AcknowledgedStore } from "./acknowledge.js";

export interface ScanResult {
  name: string;
  source: "test" | "doc" | "sourcevision" | "package";
  sourceFile: string;
  kind: "epic" | "feature" | "task";
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
  /** Explicit epic name to group this result under (overrides tag-based inference) */
  epic?: string;
}

export interface ScanOptions {
  lite?: boolean;
  /** Extra path prefixes or directory names to ignore in scanDocs */
  ignorePatterns?: string[];
}

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  PROJECT_DIRS.REX,
  ".git",
  PROJECT_DIRS.SOURCEVISION,
  "coverage",
  ".next",
  ".turbo",
]);

/** Directories that contain generated output — not human-written docs */
const SKIP_DOC_DIRS = new Set([
  "build",
  "out",
  PROJECT_DIRS.HENCH,
  ".cache",
  ".parcel-cache",
  ".vite",
  ".nuxt",
  ".svelte-kit",
  ".output",
  "tmp",
  "temp",
]);

/** File basenames that are auto-generated or machine config, not human docs */
const SKIP_DOC_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "shrinkwrap.json",
  "npm-shrinkwrap.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "jsconfig.json",
  ".eslintrc.json",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  "turbo.json",
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

/**
 * Scan test files for coverage context.
 *
 * IMPORTANT: This scanner only emits file-level features for context.
 * It does NOT create individual tasks for each test case because:
 * 1. Tests that exist are already passing — they're not work to be done
 * 2. Testing is part of the development workflow, not standalone tasks
 * 3. Test requirements should be acceptance criteria on feature tasks
 *
 * The scanner provides awareness of test coverage without polluting the
 * PRD with hundreds of "Test X" tasks that are already implemented.
 */
export async function scanTests(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const files = await globFiles(dir, isTestFile);
  const results: ScanResult[] = [];

  // Group test files by epic for a summary view
  const epicFiles = new Map<string, string[]>();

  for (const filePath of files) {
    const rel = relative(dir, filePath);
    const epicName = inferEpicName(filePath, dir);

    const list = epicFiles.get(epicName) ?? [];
    list.push(rel);
    epicFiles.set(epicName, list);
  }

  // Emit one feature per epic summarizing test coverage
  // This provides context without creating individual tasks
  for (const [epicName, testFiles] of epicFiles) {
    const fileCount = testFiles.length;
    const fileLabel = fileCount === 1 ? "1 test file" : `${fileCount} test files`;

    results.push({
      name: `${epicName} Tests`,
      source: "test",
      sourceFile: testFiles[0], // Primary file for reference
      kind: "feature",
      description: `Test coverage: ${fileLabel}`,
      tags: [epicName],
    });
  }

  return results;
}

function isDocFile(rel: string): boolean {
  const ext = extname(rel).toLowerCase();
  return [".md", ".txt", ".json", ".yaml", ".yml"].includes(ext);
}

/** Check whether a relative path lives under a generated directory or is a generated file */
function isGeneratedDoc(rel: string, extraIgnore: string[] = []): boolean {
  const base = basename(rel);

  // Skip known generated/config files
  if (SKIP_DOC_FILES.has(base)) return true;

  // Skip files inside generated output directories
  const parts = rel.split("/");
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DOC_DIRS.has(part)) return true;
  }

  // Skip user-supplied ignore patterns (prefix match on relative path)
  for (const pattern of extraIgnore) {
    if (rel.startsWith(pattern) || rel.includes(`/${pattern}`)) return true;
  }

  return false;
}

/** Strip inline markdown formatting from a heading string */
function cleanHeading(raw: string): string {
  let h = raw;
  // Bold / italic: **text**, __text__, *text*, _text_
  h = h.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
  h = h.replace(/_{1,2}([^_]+)_{1,2}/g, "$1");
  // Links: [text](url) → text
  h = h.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Inline code: `text` → text
  h = h.replace(/`([^`]+)`/g, "$1");
  // Strikethrough: ~~text~~ → text
  h = h.replace(/~~([^~]+)~~/g, "$1");
  return h.trim();
}

function extractMarkdownHeadings(
  content: string,
): { heading: string; bullets: string[] }[] {
  const lines = content.split("\n");
  const sections: { heading: string; bullets: string[] }[] = [];
  let current: { heading: string; bullets: string[] } | null = null;
  let inCodeBlock = false;

  for (const line of lines) {
    // Track fenced code blocks (``` or ~~~)
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: cleanHeading(headingMatch[1]), bullets: [] };
      continue;
    }
    if (current) {
      // Match dash/star bullets and numbered lists
      const bulletMatch = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
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
  const extraIgnore = opts.ignorePatterns ?? [];
  const files = await globFiles(dir, (rel) =>
    isDocFile(rel) && !isGeneratedDoc(rel, extraIgnore),
  );
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
  type: "observation" | "pattern" | "relationship" | "anti-pattern" | "suggestion" | "move-file";
  pass: number;
  scope: string;
  text: string;
  severity?: "info" | "warning" | "critical";
  related?: string[];
  // move-file specific fields
  from?: string;
  to?: string;
  moveReason?: "zone-pin-override" | "import-neighbor-majority" | "directory-consolidation";
  predictedImpact?: number;
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
    case "move-file":
      return "Move";
    case "pattern":
      return "Refactor";
    case "observation":
    case "relationship":
    default:
      return "Investigate";
  }
}

/** Generate a concrete fix suggestion based on finding text patterns */
function generateFixSuggestion(finding: SVFinding, zone?: SVZone): string[] {
  const suggestions: string[] = [];
  const text = finding.text.toLowerCase();

  // Pattern-based fix suggestions
  if (text.includes("circular") || text.includes("cycle")) {
    suggestions.push("Break the dependency cycle by extracting shared types to a common module");
    suggestions.push("Consider introducing an interface/abstraction to invert the dependency direction");
  }
  if (text.includes("bidirectional") || text.includes("mutual")) {
    suggestions.push("Extract shared interfaces to a dedicated types module");
    suggestions.push("Apply dependency inversion to establish unidirectional flow");
  }
  if (text.includes("god") || text.includes("too broad") || text.includes("too large")) {
    suggestions.push("Split responsibilities into focused modules with single concerns");
    if (zone && zone.files.length > 20) {
      suggestions.push(`Consider splitting into 2-3 zones (current: ${zone.files.length} files)`);
    }
  }
  if (text.includes("duplicat") || text.includes("copy-paste") || text.includes("repeated")) {
    suggestions.push("Extract duplicated logic to a shared utility function");
    suggestions.push("Create a single source of truth for this functionality");
  }
  if (text.includes("hardcoded") || text.includes("magic")) {
    suggestions.push("Extract to configuration or constants file");
    suggestions.push("Consider making values configurable via environment or config");
  }
  if (text.includes("missing test") || text.includes("no test") || text.includes("untested")) {
    suggestions.push("Add unit tests for critical code paths");
    suggestions.push("Consider TDD approach for new additions");
  }
  if (text.includes("coupling") && text.includes("high")) {
    suggestions.push("Reduce coupling by introducing abstraction layers");
    suggestions.push("Apply interface segregation to minimize dependencies");
  }
  if (text.includes("cohesion") && text.includes("low")) {
    suggestions.push("Group related functionality together");
    suggestions.push("Consider splitting into more focused modules");
  }
  if (text.includes("dead code") || text.includes("unused") || text.includes("orphan")) {
    suggestions.push("Remove unused code after verifying no hidden references");
    suggestions.push("Add tests if the code should be retained");
  }
  if (text.includes("bypass") || text.includes("violat")) {
    suggestions.push("Refactor to use the established abstraction layer");
    suggestions.push("Document exceptions if bypass is intentional");
  }
  if (text.includes("security") || text.includes("guard")) {
    suggestions.push("Add integration tests for security-critical paths");
    suggestions.push("Audit for potential bypass vectors");
  }
  if (text.includes("timeout") || text.includes("no backoff") || text.includes("retry")) {
    suggestions.push("Implement exponential backoff for retries");
    suggestions.push("Add configurable timeout with reasonable defaults");
  }
  if (text.includes("extract") || text.includes("candidate for")) {
    suggestions.push("Extract to a dedicated module when complexity increases");
    suggestions.push("Document extraction criteria for future maintainers");
  }

  return suggestions;
}

export async function scanSourceVision(
  dir: string,
  options?: { rexDir?: string },
): Promise<ScanResult[]> {
  const svDir = join(dir, PROJECT_DIRS.SOURCEVISION);
  try {
    await access(svDir);
  } catch {
    return [];
  }

  // Load acknowledged findings to filter them out
  const rexDir = options?.rexDir ?? join(dir, PROJECT_DIRS.REX);
  let ackStore: AcknowledgedStore | undefined;
  try {
    ackStore = await loadAcknowledged(rexDir);
  } catch {
    // Graceful degradation — if we can't load, don't filter
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
      // Focus on problems (anti-patterns) and actionable suggestions, skip informational items
      if (zonesData.findings) {
        for (const finding of zonesData.findings) {
          // Skip findings with no severity — not yet triaged
          if (!finding.severity) continue;

          // Only include actionable finding types:
          // - anti-pattern: something wrong that needs fixing
          // - suggestion: an improvement to implement
          // - move-file: concrete file relocation recommendation
          // Skip observations, relationships, patterns — these are informational context
          const isActionable = finding.type === "anti-pattern" || finding.type === "suggestion" || finding.type === "move-file";
          if (!isActionable) continue;

          // Only include warning/critical severity — info is too noisy for task generation
          // Exception: move-file findings with "info" severity still pass through (import-neighbor moves)
          if (finding.severity === "info" && finding.type !== "move-file") continue;

          // Compute stable hash and skip acknowledged findings
          const hash = computeFindingHash(finding);
          if (ackStore && isAcknowledged(ackStore, hash)) continue;

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

          // Build acceptance criteria from related file paths and fix suggestions
          const criteria: string[] = [];

          // Include specific file paths from the zone
          if (finding.related && finding.related.length > 0) {
            criteria.push(`Affected files: ${finding.related.join(", ")}`);
          } else if (zone && zone.files.length > 0 && zone.files.length <= 10) {
            // For zone-scoped findings without explicit related files, include zone files
            criteria.push(`Zone files: ${zone.files.join(", ")}`);
          }

          // Include entry points if available (useful for understanding impact)
          if (zone?.entryPoints && zone.entryPoints.length > 0) {
            criteria.push(`Entry points: ${zone.entryPoints.join(", ")}`);
          }

          // Zone metadata
          if (zone) {
            criteria.push(`Zone: ${zone.name} (${zone.files.length} files, cohesion: ${zone.cohesion.toFixed(2)}, coupling: ${zone.coupling.toFixed(2)})`);
          }

          // Add move-file specific criteria
          if (finding.type === "move-file" && finding.from && finding.to) {
            criteria.push(`Move from: ${finding.from}`);
            criteria.push(`Move to: ${finding.to}`);
            if (finding.moveReason) {
              const reasonLabel = finding.moveReason === "zone-pin-override"
                ? "File is pinned to a zone in a different directory"
                : finding.moveReason === "import-neighbor-majority"
                  ? "Majority of import neighbors are in the target directory"
                  : "Directory consolidation opportunity";
              criteria.push(`Reason: ${reasonLabel}`);
            }
            if (finding.predictedImpact != null && finding.predictedImpact > 0) {
              criteria.push(`Predicted impact: ${finding.predictedImpact} cross-boundary edge${finding.predictedImpact === 1 ? "" : "s"} eliminated`);
            }
            criteria.push(""); // Visual separator
            criteria.push("Steps:");
            criteria.push("• Move the file to the target directory");
            criteria.push("• Update all import paths referencing this file");
            criteria.push("• Run tests to verify no breakage");
            criteria.push("• Remove the zone pin from .n-dx.json if this was a pin-override move");
          }

          // Generate concrete fix suggestions based on finding patterns
          const fixSuggestions = generateFixSuggestion(finding, zone);
          if (fixSuggestions.length > 0) {
            criteria.push(""); // Visual separator
            criteria.push("Suggested fixes:");
            for (const suggestion of fixSuggestions) {
              criteria.push(`• ${suggestion}`);
            }
          }

          // Build tags: zone name + finding hash for feedback loop
          const tags: string[] = zone ? [zone.name] : finding.scope !== "global" ? [finding.scope] : [];
          tags.push(`finding:${hash}`);
          if (finding.type === "move-file") tags.push("structural-debt");

          results.push({
            name: `${prefix}: ${finding.text}`,
            source: "sourcevision",
            sourceFile,
            kind: "task",
            priority,
            tags: tags.length > 0 ? tags : undefined,
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
            "",
            "Suggested fixes:",
            "• Extract shared types/interfaces to a common module that both can import",
            "• Use dependency injection to invert one direction of the dependency",
            "• Consider if one module should contain the other's functionality",
            "• Lazy-load or defer the import to break the static cycle",
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

// ── scanPackageJson ─────────────────────────────────────────────────

interface PackageJsonData {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

function isPackageJson(rel: string): boolean {
  return basename(rel) === "package.json";
}

export async function scanPackageJson(
  dir: string,
  opts: ScanOptions = {},
): Promise<ScanResult[]> {
  const files = await globFiles(dir, isPackageJson);
  const results: ScanResult[] = [];

  for (const filePath of files) {
    const rel = relative(dir, filePath);

    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    let pkg: PackageJsonData;
    try {
      pkg = JSON.parse(content) as PackageJsonData;
    } catch {
      continue;
    }

    const pkgName = pkg.name ?? basename(dirname(filePath));
    const isRoot = rel === "package.json";

    if (opts.lite) {
      results.push({
        name: pkgName,
        source: "package",
        sourceFile: rel,
        kind: "feature",
      });
      continue;
    }

    // Emit a project epic for the package
    if (isRoot) {
      results.push({
        name: pkgName,
        source: "package",
        sourceFile: rel,
        kind: "epic",
        description: pkg.description,
      });
    }

    // Scripts → tasks
    if (pkg.scripts) {
      for (const [scriptName, command] of Object.entries(pkg.scripts)) {
        results.push({
          name: `Script: ${scriptName}`,
          source: "package",
          sourceFile: rel,
          kind: "task",
          description: command,
          tags: ["scripts"],
        });
      }
    }

    // Dependencies → feature summaries
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      const count = Object.keys(pkg.dependencies).length;
      const depNames = Object.keys(pkg.dependencies).slice(0, 10);
      const suffix = count > 10 ? `, +${count - 10} more` : "";
      results.push({
        name: "Dependencies",
        source: "package",
        sourceFile: rel,
        kind: "feature",
        description: `${count} production ${count === 1 ? "dependency" : "dependencies"}: ${depNames.join(", ")}${suffix}`,
        tags: ["dependencies"],
      });
    }

    if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
      const count = Object.keys(pkg.devDependencies).length;
      const depNames = Object.keys(pkg.devDependencies).slice(0, 10);
      const suffix = count > 10 ? `, +${count - 10} more` : "";
      results.push({
        name: "Dev Dependencies",
        source: "package",
        sourceFile: rel,
        kind: "feature",
        description: `${count} dev ${count === 1 ? "dependency" : "dependencies"}: ${depNames.join(", ")}${suffix}`,
        tags: ["dependencies"],
      });
    }

    // Engines → tasks noting requirements
    if (pkg.engines) {
      for (const [engine, constraint] of Object.entries(pkg.engines)) {
        results.push({
          name: `Engine: ${engine} ${constraint}`,
          source: "package",
          sourceFile: rel,
          kind: "task",
          description: `Requires ${engine} ${constraint}`,
          tags: ["engines"],
        });
      }
    }
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
