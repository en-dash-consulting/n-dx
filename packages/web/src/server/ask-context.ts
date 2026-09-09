/**
 * Ask-panel context assembly — turns the on-disk `.sourcevision/` analysis
 * into a bounded text bundle the LLM answers from.
 *
 * ## Why a bundle and not a tool-use loop
 *
 * The endpoint had two viable shapes: an in-process tool-use loop that calls
 * sourcevision lookups on demand, or a single non-agentic call over a
 * pre-assembled bundle. This module implements the bundle.
 *
 * The loop answers a wider range of questions, but every answer costs an
 * unbounded number of round trips against an interactive surface with a
 * request timeout, and a loop that runs out of turns produces a *partial*
 * answer that still looks confident. The bundle costs exactly one call, so
 * its latency and token spend are predictable, and the grounding is
 * verifiable: whatever is in the bundle is what the model saw. When a
 * question needs more than the bundle carries, the honest failure is the
 * model saying so — not a silently truncated tool loop.
 *
 * ## Grounding contract
 *
 * The bundle is the *only* project knowledge the answer may rest on. Every
 * section is derived from an artifact the analyzer wrote; nothing is inferred
 * from the working tree, and no section is synthesized. When an artifact is
 * absent the section is omitted and named in {@link AskContext.missing} rather
 * than filled with a plausible default — an answer grounded in a guess is
 * worse than an answer that admits the gap.
 *
 * @module web/server/ask-context
 * @see packages/web/src/server/routes-sourcevision-ask.ts — the endpoint
 * @see packages/web/src/server/domain-gateway.ts — where the schema types come from
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_FILES } from "../shared/index.js";
import { deriveNextSteps } from "./domain-gateway.js";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Zone,
  ZoneCrossing,
  Finding,
  NextStep,
} from "./domain-gateway.js";

// ---------------------------------------------------------------------------
// Seed context
// ---------------------------------------------------------------------------

/** Subjects a directed ask can be seeded with. */
export const ASK_SEED_KINDS = ["finding", "zone", "file"] as const;

export type AskSeedKind = (typeof ASK_SEED_KINDS)[number];

/**
 * Structured seed context for a directed ask.
 *
 * Deliberately structured rather than a pre-written prose prompt: the
 * Problems/Suggestions surfaces know the *finding*, not how to phrase a
 * question about it, and a prose seed built client-side cannot be validated
 * or re-templated server-side without parsing English back apart.
 */
export interface AskSeed {
  kind: AskSeedKind;
  /** Stable identifier of the subject — a finding id, zone id, or file path. */
  id?: string;
  /** Classification label (a finding's `type`, a file's archetype). */
  type?: string;
  /** Finding severity, when the subject has one. */
  severity?: string;
  /** Zone the subject belongs to. */
  zone?: string;
  /** Human-readable text — a finding's `text`, a zone's description. */
  message?: string;
  /** Project-relative files the subject involves. */
  files?: string[];
}

/** Longest prompt the endpoint accepts, in characters. */
export const MAX_PROMPT_CHARS = 4_000;

/** Most seed files carried through; beyond this the list is noise, not context. */
export const MAX_SEED_FILES = 40;

/** Result of validating a request body: a value, or the reason it was rejected. */
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validated shape of a POST /api/sourcevision/ask body. */
export interface AskRequest {
  prompt: string;
  seed?: AskSeed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate an optional string field, rejecting a wrong type rather than
 * coercing it. A silently dropped seed field is the failure mode this
 * prevents: the answer comes back generic and nothing says why.
 */
function optionalString(
  raw: Record<string, unknown>,
  key: string,
): Validated<string | undefined> {
  const value = raw[key];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return { ok: false, error: `seed.${key} must be a string` };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : undefined };
}

/** Validate `seed`, the optional structured subject of a directed ask. */
export function validateAskSeed(raw: unknown): Validated<AskSeed> {
  if (!isRecord(raw)) return { ok: false, error: "seed must be an object" };

  const kind = raw.kind;
  if (typeof kind !== "string" || !(ASK_SEED_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      error: `seed.kind must be one of: ${ASK_SEED_KINDS.join(", ")}`,
    };
  }

  const seed: AskSeed = { kind: kind as AskSeedKind };
  for (const key of ["id", "type", "severity", "zone", "message"] as const) {
    const field = optionalString(raw, key);
    if (!field.ok) return field;
    if (field.value !== undefined) seed[key] = field.value;
  }

  if (raw.files !== undefined && raw.files !== null) {
    if (!Array.isArray(raw.files) || raw.files.some((f) => typeof f !== "string")) {
      return { ok: false, error: "seed.files must be an array of strings" };
    }
    const files = (raw.files as string[])
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .slice(0, MAX_SEED_FILES);
    if (files.length > 0) seed.files = files;
  }

  return { ok: true, value: seed };
}

/** Validate a parsed request body for POST /api/sourcevision/ask. */
export function validateAskRequest(raw: unknown): Validated<AskRequest> {
  if (!isRecord(raw)) return { ok: false, error: "Request body must be a JSON object" };

  if (typeof raw.prompt !== "string") {
    return { ok: false, error: "'prompt' is required and must be a string" };
  }
  const prompt = raw.prompt.trim();
  if (prompt.length === 0) {
    return { ok: false, error: "'prompt' must not be empty" };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      ok: false,
      error: `'prompt' must be at most ${MAX_PROMPT_CHARS} characters (got ${prompt.length})`,
    };
  }

  if (raw.seed === undefined || raw.seed === null) return { ok: true, value: { prompt } };

  const seed = validateAskSeed(raw.seed);
  if (!seed.ok) return seed;
  return { ok: true, value: { prompt, seed: seed.value } };
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

/**
 * Section caps.
 *
 * Each cap exists to keep one artifact from crowding out the others: a
 * monorepo with 40 zones and 300 findings would otherwise spend the whole
 * budget on zone listings and send no findings at all. Ordering within each
 * capped list is by relevance (severity, then file count), so the cap drops
 * the least useful entries rather than an arbitrary tail.
 */
const MAX_ZONES = 24;
const MAX_ZONE_INSIGHTS = 2;
const MAX_CROSSING_PAIRS = 20;
const MAX_FINDINGS = 30;
const MAX_NEXT_STEPS = 8;
const MAX_CIRCULARS = 8;
const MAX_CONTEXT_MD_CHARS = 6_000;
const MAX_SEED_ZONE_FILES = 60;

/** One named block of the assembled bundle. */
export interface AskContextSection {
  /** Section heading, also the name used in {@link AskContext.missing}. */
  title: string;
  body: string;
}

/** The assembled bundle plus what could not be assembled. */
export interface AskContext {
  sections: AskContextSection[];
  /** Artifacts that were absent or unparseable, by data-file name. */
  missing: string[];
  /** Total characters across all section bodies — the payload size. */
  chars: number;
}

/** Thrown when `.sourcevision/` holds nothing an answer could be grounded in. */
export class AskAnalysisMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AskAnalysisMissingError";
  }
}

/** Read and parse a `.sourcevision/` JSON artifact. Returns null on any failure. */
function readArtifact<T>(svDir: string, filename: string): T | null {
  const path = join(svDir, filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readText(svDir: string, filename: string): string | null {
  const path = join(svDir, filename);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function severityRank(finding: Finding): number {
  return finding.severity ? (SEVERITY_RANK[finding.severity] ?? 3) : 3;
}

/**
 * A zone record with the fields this module reads guaranteed present.
 *
 * The artifacts are parsed from disk, not constructed, so their static type
 * is a claim about a file the analyzer *usually* wrote — a truncated or
 * hand-edited `zones.json` can be missing any field. Narrowing once here
 * means a malformed artifact degrades to a shorter bundle rather than
 * throwing a TypeError the route would have to report as a 500.
 */
type UsableZone = Zone & { files: string[]; cohesion: number; coupling: number };

function isUsableZone(zone: unknown): zone is UsableZone {
  if (typeof zone !== "object" || zone === null) return false;
  const z = zone as Partial<Zone>;
  return (
    typeof z.id === "string" &&
    Array.isArray(z.files) &&
    typeof z.cohesion === "number" &&
    typeof z.coupling === "number"
  );
}

function formatZone(zone: UsableZone): string {
  const metrics = `${zone.files.length} files, cohesion ${zone.cohesion.toFixed(2)}, coupling ${zone.coupling.toFixed(2)}`;
  const lines = [`- ${zone.id} — ${zone.name ?? zone.id} (${metrics})`];
  if (zone.description) lines.push(`  ${zone.description}`);
  for (const insight of (zone.insights ?? []).slice(0, MAX_ZONE_INSIGHTS)) {
    lines.push(`  · ${insight}`);
  }
  return lines.join("\n");
}

function formatFinding(finding: Finding): string {
  const severity = finding.severity ?? "unrated";
  const related = finding.related?.length ? ` [related: ${finding.related.join(", ")}]` : "";
  return `- (${severity}/${finding.type}) ${finding.scope}: ${finding.text}${related}`;
}

function formatNextStep(step: NextStep): string {
  return `- (${step.priority}/${step.category}) ${step.title} — ${step.description} [scope: ${step.scope}]`;
}

/** Aggregate the per-file crossing list into zone→zone pairs with edge counts. */
function summarizeCrossings(crossings: ZoneCrossing[]): string[] {
  const counts = new Map<string, number>();
  for (const crossing of crossings) {
    const key = `${crossing.fromZone} → ${crossing.toZone}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CROSSING_PAIRS)
    .map(([pair, count]) => `- ${pair} (${count} import${count === 1 ? "" : "s"})`);
}

/**
 * Build the seed section: the exact subject the user clicked Explain on,
 * plus the zone record it names so the answer can cite real files rather
 * than repeating the finding's own words back.
 */
function formatSeed(seed: AskSeed, usableZones: UsableZone[]): AskContextSection {
  const lines = [`kind: ${seed.kind}`];
  if (seed.id) lines.push(`id: ${seed.id}`);
  if (seed.type) lines.push(`type: ${seed.type}`);
  if (seed.severity) lines.push(`severity: ${seed.severity}`);
  if (seed.zone) lines.push(`zone: ${seed.zone}`);
  if (seed.message) lines.push(`message: ${seed.message}`);
  if (seed.files?.length) lines.push(`files:\n${seed.files.map((f) => `  - ${f}`).join("\n")}`);

  const zone = seed.zone ? usableZones.find((z) => z.id === seed.zone) : undefined;
  if (zone) {
    lines.push("", "Zone record for the seeded subject:", formatZone(zone));
    const files = zone.files.slice(0, MAX_SEED_ZONE_FILES);
    if (files.length > 0) {
      const elided = zone.files.length - files.length;
      lines.push(
        `  zone files:${files.map((f) => `\n    - ${f}`).join("")}` +
          (elided > 0 ? `\n    … and ${elided} more` : ""),
      );
    }
  }

  return { title: "Seeded subject", body: lines.join("\n") };
}

/**
 * Assemble the grounding bundle from the artifacts in `svDir`.
 *
 * @throws AskAnalysisMissingError when no artifact yields a usable section —
 *   there is nothing to ground an answer in, and the caller must say so
 *   rather than let the model answer from its own priors.
 */
export function assembleAskContext(svDir: string, seed?: AskSeed): AskContext {
  const sections: AskContextSection[] = [];
  const missing: string[] = [];

  const manifest = readArtifact<Manifest>(svDir, DATA_FILES.manifest);
  const inventory = readArtifact<Inventory>(svDir, DATA_FILES.inventory);
  const imports = readArtifact<Imports>(svDir, DATA_FILES.imports);
  const zones = readArtifact<Zones>(svDir, DATA_FILES.zones);
  const contextMd = readText(svDir, "CONTEXT.md");

  // ── Project ───────────────────────────────────────────────────────────────
  if (manifest) {
    const lines = [
      `analyzed at: ${manifest.analyzedAt}`,
      `target: ${manifest.targetPath}`,
    ];
    if (manifest.gitBranch) lines.push(`git branch: ${manifest.gitBranch}`);
    if (manifest.languages?.length) lines.push(`languages: ${manifest.languages.join(", ")}`);
    else if (manifest.language) lines.push(`language: ${manifest.language}`);
    if (manifest.workspace) lines.push("workspace aggregation: yes");
    sections.push({ title: "Project", body: lines.join("\n") });
  } else {
    missing.push(DATA_FILES.manifest);
  }

  // ── Inventory ─────────────────────────────────────────────────────────────
  if (inventory?.summary) {
    const s = inventory.summary;
    const byLanguage = Object.entries(s.byLanguage ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${lang} ${count}`)
      .join(", ");
    const lines = [`files: ${s.totalFiles}`, `lines: ${s.totalLines}`];
    if (byLanguage) lines.push(`by language: ${byLanguage}`);
    sections.push({ title: "File inventory", body: lines.join("\n") });
  } else {
    missing.push(DATA_FILES.inventory);
  }

  // ── Zones ─────────────────────────────────────────────────────────────────
  const usableZones = Array.isArray(zones?.zones) ? zones.zones.filter(isUsableZone) : [];
  if (usableZones.length > 0) {
    const ranked = [...usableZones].sort((a, b) => b.files.length - a.files.length);
    const shown = ranked.slice(0, MAX_ZONES);
    const body = shown.map(formatZone).join("\n");
    const elided = ranked.length - shown.length;
    sections.push({
      title: "Architectural zones",
      body: elided > 0 ? `${body}\n- … and ${elided} smaller zones` : body,
    });

    const crossings = summarizeCrossings(
      Array.isArray(zones?.crossings) ? zones.crossings : [],
    );
    if (crossings.length > 0) {
      sections.push({ title: "Cross-zone imports", body: crossings.join("\n") });
    }

    const findings = (Array.isArray(zones?.findings) ? [...zones.findings] : []).sort(
      (a, b) => severityRank(a) - severityRank(b),
    );
    if (findings.length > 0) {
      const shownFindings = findings.slice(0, MAX_FINDINGS);
      const body2 = shownFindings.map(formatFinding).join("\n");
      const elided2 = findings.length - shownFindings.length;
      sections.push({
        title: "Findings",
        body: elided2 > 0 ? `${body2}\n- … and ${elided2} further findings` : body2,
      });
    }

    // Prioritized next steps come from sourcevision's own derivation rather
    // than a web-side reimplementation, so the Ask panel and the Overview
    // panel cannot disagree about what matters.
    const nextSteps = deriveNextSteps({
      ...(zones as Zones),
      zones: usableZones,
      crossings: Array.isArray(zones?.crossings) ? zones.crossings : [],
      unzoned: Array.isArray(zones?.unzoned) ? zones.unzoned : [],
    }).slice(0, MAX_NEXT_STEPS);
    if (nextSteps.length > 0) {
      sections.push({
        title: "Prioritized next steps",
        body: nextSteps.map(formatNextStep).join("\n"),
      });
    }
  } else {
    missing.push(DATA_FILES.zones);
  }

  // ── Imports ───────────────────────────────────────────────────────────────
  if (imports?.summary) {
    const s = imports.summary;
    const lines = [
      `internal edges: ${s.totalEdges}`,
      `external packages: ${s.totalExternal}`,
      `circular dependencies: ${s.circularCount}`,
    ];
    const circulars = (s.circulars ?? []).slice(0, MAX_CIRCULARS);
    for (const circular of circulars) {
      lines.push(`- cycle: ${circular.cycle.join(" → ")}`);
    }
    const mostImported = (s.mostImported ?? []).slice(0, 10);
    if (mostImported.length > 0) {
      lines.push(
        `most imported: ${mostImported.map((m) => `${m.path} (${m.count})`).join(", ")}`,
      );
    }
    sections.push({ title: "Import graph", body: lines.join("\n") });
  } else {
    missing.push(DATA_FILES.imports);
  }

  // ── CONTEXT.md ────────────────────────────────────────────────────────────
  if (contextMd?.trim()) {
    const excerpt = contextMd.length > MAX_CONTEXT_MD_CHARS
      ? `${contextMd.slice(0, MAX_CONTEXT_MD_CHARS)}\n… (truncated)`
      : contextMd;
    sections.push({ title: "CONTEXT.md", body: excerpt });
  } else {
    missing.push("CONTEXT.md");
  }

  if (sections.length === 0) {
    throw new AskAnalysisMissingError(
      "No sourcevision analysis found. Run `ndx analyze .` before asking a question about this project.",
    );
  }

  // The seed goes last so it is the closest context to the question, and is
  // never itself a reason the bundle counts as non-empty — a seeded ask
  // against an unanalyzed project still fails above.
  if (seed) sections.push(formatSeed(seed, usableZones));

  return {
    sections,
    missing,
    chars: sections.reduce((sum, s) => sum + s.body.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Grounding instructions.
 *
 * The "say you don't know" clause is load-bearing, not politeness: the model
 * knows a great deal about codebases in general and nothing about this one
 * beyond the bundle, so without an explicit licence to decline it will fill
 * a gap with generic advice that reads exactly like an answer.
 */
const ASK_SYSTEM_PREAMBLE = [
  "You are answering a question about one specific software project.",
  "",
  "The ANALYSIS CONTEXT below is the output of a static analysis of that project and is your only source of truth about it.",
  "Rules:",
  "- Ground every claim about this project in the analysis context. Name the actual zones, files, and findings it contains.",
  "- If the context does not contain what the question needs, say exactly what is missing and what would produce it (e.g. `ndx analyze --deep .`). Do not substitute generic advice.",
  "- Do not invent file paths, zone names, metrics, or findings that do not appear in the context.",
  "- General software-engineering knowledge is welcome as explanation, but it must be attached to something in the context.",
  "- Answer in Markdown. Be concise; prefer specifics over preamble.",
].join("\n");

/**
 * What an explanation of a finding has to contain.
 *
 * Lives here rather than in the client's prompt text for two reasons. The
 * Problems and Suggestions surfaces know the finding, not how to phrase a
 * question about it — that is the same reason the seed is structured — and
 * an explanation whose requirements are typed into a button handler cannot
 * be tested without a live model. Assembled server-side, the contract is a
 * property of the prompt and can be asserted directly.
 *
 * The three clauses are the difference between a definition and an
 * explanation: an answer that could have been written without reading this
 * repository has failed, however fluent it is.
 */
const FINDING_EXPLAIN_DIRECTIVE = [
  "This is a request to explain one finding, seeded above under \"Seeded subject\".",
  "Structure the answer as:",
  "1. What the finding means, in plain language.",
  "2. Why it matters *in this repository* — name the seeded zone and the seeded files, and say what about them produced the finding. Generic advice about this finding type is not an answer.",
  "3. What a fix would touch — the files, modules or boundaries a change would have to move, and roughly how far the blast radius reaches.",
  "If the analysis context does not carry what a clause needs, say so for that clause rather than filling it in from general knowledge.",
].join("\n");

/** Render the assembled bundle and the user's question into one prompt. */
export function buildAskPrompt(request: AskRequest, context: AskContext): string {
  const parts = [ASK_SYSTEM_PREAMBLE, "", "# ANALYSIS CONTEXT"];
  for (const section of context.sections) {
    parts.push("", `## ${section.title}`, section.body);
  }
  if (context.missing.length > 0) {
    parts.push(
      "",
      "## Absent artifacts",
      `These analysis outputs were not available, so nothing may be claimed about them: ${context.missing.join(", ")}.`,
    );
  }
  parts.push("", "# QUESTION", request.prompt);
  // Directives go after the question so they are the last thing read, and
  // only for a finding: a zone or file seed is not an explain request.
  if (request.seed?.kind === "finding") {
    parts.push("", "# HOW TO ANSWER", FINDING_EXPLAIN_DIRECTIVE);
  }
  return parts.join("\n");
}
