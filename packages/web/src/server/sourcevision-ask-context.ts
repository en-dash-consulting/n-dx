/**
 * Context assembly for the SourceVision Ask endpoint.
 *
 * Builds the grounding bundle that `POST /api/sourcevision/ask` sends to the
 * LLM. The bundle is assembled from the `.sourcevision/` artifacts that
 * `sourcevision analyze` has already written — the endpoint never re-analyses
 * the project and never reads application source, so the analysis output is
 * its only ground truth.
 *
 * ## Why a pre-assembled bundle rather than a tool-use loop
 *
 * A loop that lets the model query sourcevision lookups on demand answers a
 * wider range of questions, but costs an unbounded number of round trips per
 * question and makes "what did the model actually see?" untestable. A single
 * non-agentic call over a bounded bundle is cheaper, has a predictable token
 * cost, and lets a unit test assert exactly which analysis facts reached the
 * model. If the panel later needs lookups the bundle cannot carry (a specific
 * file's imports, say), the loop belongs behind this same function's output as
 * an additional stage rather than as a replacement for it.
 *
 * Every section is capped. An unbounded bundle would blow the context window
 * on a large repository, and the failure would land on the vendor's side as an
 * opaque 400 rather than here where it can be reasoned about.
 *
 * @module web/server/sourcevision-ask-context
 * @see routes-sourcevision-ask.ts — the endpoint that consumes this
 * @see domain-gateway.ts — the sole path to sourcevision types/functions
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { DATA_FILES } from "../shared/index.js";
import { deriveNextSteps } from "./domain-gateway.js";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Components,
  NextStep,
} from "./domain-gateway.js";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/** Zones listed in full (name, metrics, description). */
const MAX_ZONES = 25;
/** Findings carried from `zones.json`. */
const MAX_FINDINGS = 30;
/** Derived next steps carried from `deriveNextSteps`. */
const MAX_NEXT_STEPS = 10;
/** Largest files listed, by line count. */
const MAX_LARGEST_FILES = 30;
/** Most-imported entries carried from the imports summary. */
const MAX_HUB_FILES = 10;
/** Circular dependency cycles listed. */
const MAX_CIRCULARS = 5;
/** Characters of `CONTEXT.md` included verbatim. */
const MAX_CONTEXT_MD_CHARS = 6_000;
/** Characters of a single zone description or finding kept. */
const MAX_PROSE_CHARS = 400;
/**
 * Files listed for the seeded item.
 *
 * Higher than a display cap would be: these are the paths the answer is asked
 * to name, so cutting them costs specificity — which is the whole point of
 * seeding. A finding naming more than this is describing a zone, and the zone
 * section already covers it.
 */
const MAX_SEED_FILES = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Optional pointer to what the user was looking at when they asked.
 *
 * Deliberately loose: the directed entry points (explain-a-finding from the
 * Problems/Suggestions surfaces, and later zone/file surfaces) each name a
 * different kind of thing, and the answer quality comes from the verbatim
 * `text` rather than from the server resolving `id` against an artifact. A
 * seed only ever *adds* a focus section — it never replaces the bundle, so a
 * stale or unrecognised `id` degrades to a slightly less focused answer
 * instead of an error.
 */
export interface AskSeed {
  /** Which surface the question came from, e.g. `"finding"` or `"zone"`. */
  kind?: string;
  /** Identifier on that surface: a zone ID, a file path, a finding scope. */
  id?: string;
  /** Verbatim text of the thing being asked about. */
  text?: string;
  /** Zone the thing belongs to. `"global"` when it is project-wide. */
  zone?: string;
  /**
   * Files (or zones) the thing names.
   *
   * Carried as a list rather than folded into `text` because the answer is
   * required to name them: a model given `related: [a, b]` as prose has to
   * re-extract the paths before it can talk about them, and re-extraction is
   * where invented paths come from.
   */
  files?: string[];
  /**
   * Classification labels the surface applies — for a finding, its type and
   * severity. A map rather than named fields because each surface classifies
   * differently, and a zone seed's labels are not a finding's.
   */
  labels?: Record<string, string>;
}

/** The assembled grounding bundle. */
export interface AskContext {
  /**
   * True when at least one analysis artifact was readable. False means the
   * project has not been analysed (or `.sourcevision/` is unreadable), and
   * the caller must refuse rather than let the model answer ungrounded.
   */
  available: boolean;
  /** Artifact filenames that contributed, relative to `.sourcevision/`. */
  sources: string[];
  /** The rendered context block, ready to embed in a prompt. */
  text: string;
  /**
   * True when a seed produced a focus section.
   *
   * The caller adds instructions that refer to that section by name, so this
   * is reported rather than re-derived from the seed: a seed carrying only
   * blank fields renders nothing, and rules pointing at an absent section
   * would be the model's problem to reconcile.
   */
  seeded: boolean;
}

// ---------------------------------------------------------------------------
// Artifact reads
// ---------------------------------------------------------------------------

/**
 * Parse one `.sourcevision/` JSON artifact.
 *
 * Returns null for absent *and* for malformed files: a half-written artifact
 * from an interrupted analyze run must degrade the bundle, not fail the
 * request, because the remaining artifacts are still valid grounding.
 */
function readJsonArtifact<T>(svDir: string, filename: string): T | null {
  const path = join(svDir, filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readTextArtifact(svDir: string, filename: string): string | null {
  const path = join(svDir, filename);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf-8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** Note a section the bundle had to cut, so the model knows the list is partial. */
function omissionNote(total: number, shown: number, noun: string): string | null {
  if (total <= shown) return null;
  return `_(${total - shown} further ${noun} omitted from this context.)_`;
}

function renderProject(manifest: Manifest | null): string[] {
  if (!manifest) return [];
  const lines = ["## Project"];
  // Field-by-field guards rather than a shape assertion: manifests written by
  // older tool versions omit fields the current schema declares required.
  if (manifest.targetPath) lines.push(`- Path: ${manifest.targetPath}`);
  if (manifest.language) lines.push(`- Primary language: ${manifest.language}`);
  if (manifest.languages?.length) {
    lines.push(`- Languages detected: ${manifest.languages.join(", ")}`);
  }
  if (manifest.gitBranch) lines.push(`- Git branch: ${manifest.gitBranch}`);
  if (manifest.analyzedAt) lines.push(`- Analyzed at: ${manifest.analyzedAt}`);
  if (manifest.workspace) lines.push("- This is a workspace aggregation of several packages.");
  return lines.length > 1 ? lines : [];
}

function renderInventory(inventory: Inventory | null): string[] {
  if (!inventory) return [];
  const lines = ["## Files"];
  const summary = inventory.summary;
  if (summary) {
    lines.push(`- Total files: ${summary.totalFiles ?? "unknown"}`);
    lines.push(`- Total lines: ${summary.totalLines ?? "unknown"}`);
    if (summary.byLanguage) {
      const byLanguage = Object.entries(summary.byLanguage)
        .sort((a, b) => b[1] - a[1])
        .map(([language, count]) => `${language} ${count}`)
        .join(", ");
      if (byLanguage) lines.push(`- By language: ${byLanguage}`);
    }
  }

  const files = Array.isArray(inventory.files) ? inventory.files : [];
  if (files.length > 0) {
    const largest = [...files]
      .sort((a, b) => (b.lineCount ?? 0) - (a.lineCount ?? 0))
      .slice(0, MAX_LARGEST_FILES);
    lines.push("", `### Largest files (top ${largest.length} of ${files.length}, by lines)`);
    for (const file of largest) {
      const facts = [
        file.lineCount != null ? `${file.lineCount} lines` : null,
        file.role ? `role: ${file.role}` : null,
        file.category ? `category: ${file.category}` : null,
      ].filter(Boolean);
      lines.push(`- \`${file.path}\`${facts.length ? ` — ${facts.join(", ")}` : ""}`);
    }
  }
  return lines.length > 1 ? lines : [];
}

function renderZones(zones: Zones | null): string[] {
  if (!zones) return [];
  const all = Array.isArray(zones.zones) ? zones.zones : [];
  if (all.length === 0) return [];

  const lines = ["## Architectural zones"];
  // Largest zones first: on a repo with more zones than the cap, the ones
  // carrying the most code are the ones a question is most likely about.
  const shown = [...all]
    .sort((a, b) => (b.files?.length ?? 0) - (a.files?.length ?? 0))
    .slice(0, MAX_ZONES);
  for (const zone of shown) {
    const metrics = [
      zone.files ? `${zone.files.length} files` : null,
      typeof zone.cohesion === "number" ? `cohesion ${zone.cohesion.toFixed(2)}` : null,
      typeof zone.coupling === "number" ? `coupling ${zone.coupling.toFixed(2)}` : null,
      zone.detectionQuality && zone.detectionQuality !== "genuine"
        ? `detection quality: ${zone.detectionQuality}`
        : null,
    ].filter(Boolean);
    lines.push(`- **${zone.name ?? zone.id}** (\`${zone.id}\`)${metrics.length ? ` — ${metrics.join(", ")}` : ""}`);
    if (zone.description) lines.push(`  - ${truncate(zone.description, MAX_PROSE_CHARS)}`);
    if (zone.entryPoints?.length) {
      lines.push(`  - Entry points: ${zone.entryPoints.slice(0, 5).map((p) => `\`${p}\``).join(", ")}`);
    }
  }
  const note = omissionNote(all.length, shown.length, "zones");
  if (note) lines.push("", note);

  if (Array.isArray(zones.unzoned) && zones.unzoned.length > 0) {
    lines.push("", `- ${zones.unzoned.length} file(s) belong to no zone.`);
  }
  if (Array.isArray(zones.insights) && zones.insights.length > 0) {
    lines.push("", "### Cross-zone insights");
    for (const insight of zones.insights.slice(0, MAX_NEXT_STEPS)) {
      lines.push(`- ${truncate(insight, MAX_PROSE_CHARS)}`);
    }
  }
  return lines;
}

function renderFindings(zones: Zones | null): string[] {
  if (!zones) return [];
  const all = Array.isArray(zones.findings) ? zones.findings : [];
  if (all.length === 0) return [];

  // Severity order, then critical-first, so a cap never drops the worst news.
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const shown = [...all]
    .sort((a, b) => (rank[a.severity ?? "info"] ?? 3) - (rank[b.severity ?? "info"] ?? 3))
    .slice(0, MAX_FINDINGS);

  const lines = ["## Analysis findings"];
  for (const finding of shown) {
    const tags = [finding.severity, finding.type, finding.category].filter(Boolean).join("/");
    lines.push(`- [${tags}] (${finding.scope}) ${truncate(finding.text, MAX_PROSE_CHARS)}`);
  }
  const note = omissionNote(all.length, shown.length, "findings");
  if (note) lines.push("", note);
  return lines;
}

function renderNextSteps(zones: Zones | null): string[] {
  if (!zones) return [];
  let steps: NextStep[];
  try {
    steps = deriveNextSteps(zones);
  } catch {
    // Derivation is a convenience on top of data already in the bundle; a
    // malformed zones payload must not cost the caller the whole context.
    return [];
  }
  if (steps.length === 0) return [];

  const lines = ["## Prioritized next steps (derived from the findings above)"];
  for (const step of steps.slice(0, MAX_NEXT_STEPS)) {
    lines.push(`- [${step.priority}] ${truncate(step.title, MAX_PROSE_CHARS)}`);
  }
  return lines;
}

function renderImports(imports: Imports | null): string[] {
  if (!imports?.summary) return [];
  const summary = imports.summary;
  const lines = ["## Dependency graph"];
  if (summary.totalEdges != null) lines.push(`- Import edges: ${summary.totalEdges}`);
  if (summary.totalExternal != null) lines.push(`- External packages: ${summary.totalExternal}`);
  if (summary.avgImportsPerFile != null) {
    lines.push(`- Average imports per file: ${summary.avgImportsPerFile}`);
  }
  if (summary.circularCount != null) lines.push(`- Circular dependencies: ${summary.circularCount}`);
  for (const circular of (summary.circulars ?? []).slice(0, MAX_CIRCULARS)) {
    lines.push(`  - cycle: ${circular.cycle.join(" → ")}`);
  }
  if (summary.mostImported?.length) {
    lines.push("", `### Most-imported files (top ${Math.min(summary.mostImported.length, MAX_HUB_FILES)})`);
    for (const entry of summary.mostImported.slice(0, MAX_HUB_FILES)) {
      lines.push(`- \`${entry.path}\` — imported by ${entry.count}`);
    }
  }
  return lines.length > 1 ? lines : [];
}

function renderComponents(components: Components | null): string[] {
  if (!components) return [];
  const all = Array.isArray(components.components) ? components.components : [];
  if (all.length === 0) return [];
  return ["## UI components", `- ${all.length} component(s) catalogued.`];
}

function renderContextMd(contextMd: string | null): string[] {
  if (!contextMd) return [];
  return [
    "## CONTEXT.md (analysis narrative, excerpt)",
    "",
    contextMd.length > MAX_CONTEXT_MD_CHARS
      ? `${contextMd.slice(0, MAX_CONTEXT_MD_CHARS)}\n\n_(excerpt truncated)_`
      : contextMd,
  ];
}

function renderSeed(seed: AskSeed | undefined): string[] {
  if (!seed) return [];
  const labels = Object.entries(seed.labels ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value}`);
  // Paths are fenced individually rather than joined into one span, so a file
  // list stays copy-pasteable in whatever the model quotes back.
  const files = (seed.files ?? [])
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, MAX_SEED_FILES)
    .map((entry) => `\`${entry.trim()}\``);

  const facts = [
    seed.kind ? `- Surface: ${seed.kind}` : null,
    seed.id ? `- Identifier: \`${seed.id}\`` : null,
    labels.length > 0 ? `- Classified as: ${labels.join(", ")}` : null,
    seed.zone ? `- Zone: \`${seed.zone}\`` : null,
    files.length > 0 ? `- Files involved: ${files.join(", ")}` : null,
    seed.text ? `- Text: ${truncate(seed.text, MAX_PROSE_CHARS * 4)}` : null,
  ].filter(Boolean) as string[];
  if (facts.length === 0) return [];

  const omitted = omissionNote((seed.files ?? []).length, files.length, "files");
  return ["## What the user is looking at", ...facts, ...(omitted ? [omitted] : [])];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the grounding bundle from the project's `.sourcevision/` artifacts.
 *
 * Performs no network or LLM work — it is pure disk reads plus rendering, so a
 * test can assert the exact text the endpoint will send.
 */
export function assembleAskContext(ctx: ServerContext, seed?: AskSeed): AskContext {
  const manifest = readJsonArtifact<Manifest>(ctx.svDir, DATA_FILES.manifest);
  const inventory = readJsonArtifact<Inventory>(ctx.svDir, DATA_FILES.inventory);
  const imports = readJsonArtifact<Imports>(ctx.svDir, DATA_FILES.imports);
  const zones = readJsonArtifact<Zones>(ctx.svDir, DATA_FILES.zones);
  const components = readJsonArtifact<Components>(ctx.svDir, DATA_FILES.components);
  const contextMd = readTextArtifact(ctx.svDir, "CONTEXT.md");

  const sources: string[] = [];
  if (manifest) sources.push(DATA_FILES.manifest);
  if (inventory) sources.push(DATA_FILES.inventory);
  if (imports) sources.push(DATA_FILES.imports);
  if (zones) sources.push(DATA_FILES.zones);
  if (components) sources.push(DATA_FILES.components);
  if (contextMd) sources.push("CONTEXT.md");

  const seedSection = renderSeed(seed);
  const sections: string[][] = [
    renderProject(manifest),
    renderInventory(inventory),
    renderZones(zones),
    renderFindings(zones),
    renderNextSteps(zones),
    renderImports(imports),
    renderComponents(components),
    renderContextMd(contextMd),
    seedSection,
  ];

  const body = sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");

  return {
    available: sources.length > 0,
    sources,
    text: body,
    seeded: seedSection.length > 0,
  };
}
