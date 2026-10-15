/**
 * The rules a project wrote down about itself, checked against its graph.
 *
 * Every other finding in this analyser is derived from structure alone, which
 * means it can only ever say what is unusual — never what is *wrong here*. A
 * repository that writes "orchestration scripts spawn CLIs; they never import
 * from packages" has stated a rule no metric encodes, and the import graph
 * already knows whether it holds.
 *
 * Two steps, and both are skipped on a repository that declares nothing:
 *
 * 1. **Extract, once.** The project's own documents — `CLAUDE.md`,
 *    `ARCHITECTURE.md`, the analysis directory's `hints.md` — go to the text
 *    model in one call, which returns `{ rule, source, quote }` per rule it
 *    found. The result is cached beside the other judgment caches against a
 *    hash of those documents, so the call is paid once per edit of them, not
 *    once per run.
 * 2. **Check, per edge class.** Not per edge — a zone pair is the unit a rule
 *    is written about, and asking about each of 400 crossings separately would
 *    be 400 questions to answer the same thing. Each (pair, rule) is one Noul;
 *    a confirmed violation becomes an `anti-pattern` finding quoting the line
 *    of the document it breaks, so a reader can argue with the rule rather
 *    than with the analyser.
 *
 * The extraction is generation (prose in, structure out) and the check is
 * judgment, which is why they run on different routes. A repository with no
 * such documents makes neither call.
 *
 * @module sourcevision/analyzers/declared-rules
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Finding, TokenUsage, Zone, ZoneCrossing } from "../schema/index.js";
import { askJev, noul } from "@n-dx/llm-client";
import type { JevQuestion, JsonValue } from "@n-dx/llm-client";
import { callClaude, ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { tryParseJSON } from "./enrich-parsing.js";
import { SV_CACHE_DIRNAME } from "../paths.js";

/** Documents searched for declared rules, relative to the project root. */
export const RULE_DOC_PATHS = [
  "CLAUDE.md",
  "ARCHITECTURE.md",
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
];

/**
 * The hints file, searched alongside them. It is not in the list above
 * because its directory is the layout's to name, not this module's — the
 * analysis directory is `.ndx/sourcevision` under one layout and
 * `.sourcevision` under another. It comes from {@link configureRuleCache}'s
 * `svDir` for the same reason the cache does.
 */
export const HINTS_FILENAME = "hints.md";

/** Characters read from each document. A rule stated on page nine is not a rule. */
const DOC_CHARS = 12_000;
/** Rules carried forward. More than this and the per-pair cost stops being worth it. */
export const MAX_RULES = 8;
/** Zone pairs checked, busiest first. */
export const MAX_PAIRS = 20;
/** Questions per request. */
const QUESTIONS_PER_REQUEST = 40;
/** Minimum Noul probability for a crossing to be reported as a violation. */
export const RULE_VIOLATION_MIN_PROBABILITY = 0.7;

/** One architecture rule the project states about itself. */
export interface DeclaredRule {
  /** The rule in one sentence, as an instruction. */
  rule: string;
  /** The document it came from, project-relative. */
  source: string;
  /** The sentence in that document it was read from. */
  quote: string;
}

/** A document that may declare rules. */
export interface RuleDoc {
  path: string;
  text: string;
}

// ── Documents ────────────────────────────────────────────────────────────────

/**
 * The rule documents this project actually has, in {@link RULE_DOC_PATHS}
 * order followed by the hints file.
 *
 * @param svDir - The analysis directory, for the hints file. Defaults to the
 *                one {@link configureRuleCache} was given; without either, the
 *                hints file is simply not searched.
 */
export function findRuleDocs(projectDir: string, svDir: string | undefined = _svDir): RuleDoc[] {
  const docs: RuleDoc[] = [];
  const read = (abs: string, label: string): void => {
    if (!existsSync(abs)) return;
    try {
      const text = readFileSync(abs, "utf-8").slice(0, DOC_CHARS);
      if (text.trim()) docs.push({ path: label, text });
    } catch {
      // unreadable document → not a source of rules
    }
  };
  for (const rel of RULE_DOC_PATHS) read(join(projectDir, rel), rel);
  if (svDir) read(join(svDir, HINTS_FILENAME), relative(projectDir, join(svDir, HINTS_FILENAME)).split(sep).join("/"));
  return docs;
}

/** Content hash of the documents, the cache key for their extracted rules. */
export function ruleDocHash(docs: RuleDoc[]): string {
  const h = createHash("sha256");
  for (const d of docs) {
    h.update(d.path);
    h.update("\0");
    h.update(d.text);
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface RuleCacheFile {
  hash: string;
  rules: DeclaredRule[];
}

let _svDir: string | undefined;
let _cachePath: string | undefined;

/**
 * Point the rule cache — and the hints document — at the analysis directory.
 * Until this is called nothing is read or written there, so library callers
 * and tests see no files: the same contract as `configureJudgmentCache` and
 * `configureRerunLog`.
 */
export function configureRuleCache(opts: { svDir: string } | undefined): void {
  _svDir = opts?.svDir;
  _cachePath = opts ? join(opts.svDir, SV_CACHE_DIRNAME, "rules.json") : undefined;
}

function readRuleCache(hash: string): DeclaredRule[] | undefined {
  if (!_cachePath || !existsSync(_cachePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(_cachePath, "utf-8")) as RuleCacheFile;
    if (parsed.hash !== hash || !Array.isArray(parsed.rules)) return undefined;
    return parsed.rules;
  } catch {
    return undefined;
  }
}

function writeRuleCache(hash: string, rules: DeclaredRule[]): void {
  if (!_cachePath) return;
  try {
    mkdirSync(join(_cachePath, ".."), { recursive: true });
    writeFileSync(_cachePath, JSON.stringify({ hash, rules } satisfies RuleCacheFile, null, 2));
  } catch {
    // Never fail an analysis for its cache.
  }
}

// ── Extraction ───────────────────────────────────────────────────────────────

export interface RuleExtraction {
  rules: DeclaredRule[];
  calls: number;
  tokenUsage?: TokenUsage;
  /** True when the cache answered and no call was made. */
  cached: boolean;
}

/** The prompt, exported so the shape of what is asked for is readable in one place. */
export function buildRuleExtractionPrompt(docs: RuleDoc[]): string {
  const blocks = docs.map((d) => `--- ${d.path} ---\n${d.text}`).join("\n\n");
  return [
    `Read these project documents and list the architecture rules they state — constraints on what may import, depend on, or call what, and where code of a given kind must live.`,
    "",
    `Only rules the documents actually state. Do not infer, generalise, or add conventional advice. If the documents state no such rule, return an empty array.`,
    "",
    blocks,
    "",
    `Respond with ONLY a JSON array of at most ${MAX_RULES} objects: [{"rule":"one sentence, phrased as an instruction","source":"the document path","quote":"the sentence you read it from"}]`,
  ].join("\n");
}

/**
 * Extract the project's declared architecture rules, caching by document hash.
 *
 * Returns no rules and makes no call when the project has none of the
 * documents, which is the common case outside a repository that documents
 * itself.
 */
export async function extractDeclaredRules(projectDir: string | undefined): Promise<RuleExtraction> {
  if (!projectDir) return { rules: [], calls: 0, cached: false };
  const docs = findRuleDocs(projectDir);
  if (docs.length === 0) return { rules: [], calls: 0, cached: false };

  const hash = ruleDocHash(docs);
  const cached = readRuleCache(hash);
  if (cached) {
    console.log(`  [rules] ${cached.length} declared rule(s) from cache (${docs.map((d) => d.path).join(", ")})`);
    return { rules: cached, calls: 0, cached: true };
  }

  let text: string;
  let tokenUsage: TokenUsage | undefined;
  try {
    const response = await callClaude(buildRuleExtractionPrompt(docs), undefined, { taskClass: "zone.enrich-scan" });
    text = response.text;
    tokenUsage = response.tokenUsage;
  } catch (err) {
    if (err instanceof ClaudeClientError) {
      console.warn(`  [rules] rule extraction failed (${err.reason}) — no declared-rule checks this run`);
      return { rules: [], calls: 0, cached: false };
    }
    throw err;
  }

  const rules = parseDeclaredRules(text, docs);
  writeRuleCache(hash, rules);
  console.log(`  [rules] ${rules.length} declared rule(s) extracted from ${docs.length} document(s)`);
  return { rules, calls: 1, tokenUsage, cached: false };
}

/** Validate the model's array, dropping anything that is not a full rule. */
export function parseDeclaredRules(text: string, docs: RuleDoc[]): DeclaredRule[] {
  const parsed = tryParseJSON(text);
  if (!Array.isArray(parsed)) return [];
  const known = new Set(docs.map((d) => d.path));
  const out: DeclaredRule[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { rule, source, quote } = item as Record<string, unknown>;
    if (typeof rule !== "string" || !rule.trim()) continue;
    if (typeof source !== "string" || !known.has(source)) continue;
    if (typeof quote !== "string" || !quote.trim()) continue;
    out.push({ rule: rule.trim(), source, quote: quote.trim() });
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

// ── Checking ─────────────────────────────────────────────────────────────────

/** A zone pair with the crossings that make it, busiest first. */
export interface EdgeClass {
  fromZone: string;
  toZone: string;
  crossings: ZoneCrossing[];
}

/** Cross-zone edge classes, busiest first, capped at {@link MAX_PAIRS}. */
export function edgeClasses(crossings: ZoneCrossing[]): EdgeClass[] {
  const byPair = new Map<string, ZoneCrossing[]>();
  for (const c of crossings) {
    if (c.fromZone === c.toZone) continue;
    const key = `${c.fromZone}\u0000${c.toZone}`;
    byPair.set(key, [...(byPair.get(key) ?? []), c]);
  }
  return [...byPair.entries()]
    .map(([key, cs]) => {
      const [fromZone, toZone] = key.split("\u0000");
      return { fromZone, toZone, crossings: cs };
    })
    .sort((a, b) => b.crossings.length - a.crossings.length || a.fromZone.localeCompare(b.fromZone))
    .slice(0, MAX_PAIRS);
}

export interface RuleCheckResult {
  findings: Finding[];
  calls: number;
  tokenUsage?: TokenUsage;
  /** (pair, rule) combinations asked about. */
  asked: number;
}

/** Example crossings shown per pair; the anchors carry the rest. */
const CROSSINGS_SHOWN = 8;

/**
 * Ask Jev, per (edge class, rule), whether the crossing violates the rule.
 * Inert without a `finding.judge` route, and never called with no rules.
 */
export async function judgeRuleViolations(
  rules: DeclaredRule[],
  zones: Zone[],
  crossings: ZoneCrossing[],
  pass: number,
): Promise<RuleCheckResult> {
  const result: RuleCheckResult = { findings: [], calls: 0, asked: 0 };
  if (rules.length === 0 || getJudgmentRoute("finding.judge") !== "typesafe") return result;
  const classes = edgeClasses(crossings);
  if (classes.length === 0) return result;

  const names = new Map(zones.map((z) => [z.id, z.name]));
  const usage: TokenUsage = { input: 0, output: 0 };
  const pending: Array<{ edge: EdgeClass; rule: DeclaredRule; ruleIndex: number; edgeIndex: number }> = [];
  classes.forEach((edge, edgeIndex) => {
    rules.forEach((rule, ruleIndex) => pending.push({ edge, rule, ruleIndex, edgeIndex }));
  });
  result.asked = pending.length;

  for (let start = 0; start < pending.length; start += QUESTIONS_PER_REQUEST) {
    const slice = pending.slice(start, start + QUESTIONS_PER_REQUEST);
    const ruleState: Record<string, JsonValue> = {};
    const edgeState: Record<string, JsonValue> = {};
    const questions: Record<string, JevQuestion> = {};
    for (const { edge, rule, ruleIndex, edgeIndex } of slice) {
      ruleState[`r${ruleIndex}`] = { rule: rule.rule, source: rule.source, quote: rule.quote };
      edgeState[`e${edgeIndex}`] = {
        from: names.get(edge.fromZone) ?? edge.fromZone,
        to: names.get(edge.toZone) ?? edge.toZone,
        edgeCount: edge.crossings.length,
        examples: edge.crossings.slice(0, CROSSINGS_SHOWN).map((c) => `${c.from} → ${c.to}`),
      };
      questions[`v${edgeIndex}-${ruleIndex}`] = noul(
        `Do the imports in \`edges.e${edgeIndex}\` violate the rule stated in \`rules.r${ruleIndex}\`? ` +
          `Answer yes only if the rule forbids exactly this kind of dependency; a rule about something else is not a violation.`,
      );
    }
    let response;
    try {
      response = await askJev({ state: { rules: ruleState, edges: edgeState }, questions }, { taskClass: "finding.judge" });
    } catch (err) {
      if (!(err instanceof ClaudeClientError)) throw err;
      console.warn(`  [rules] violation judgment failed (${err.reason}) — no declared-rule findings: ${err.message.slice(0, 160)}`);
      break;
    }
    result.calls++;
    if (response.tokenUsage) {
      usage.input += response.tokenUsage.input;
      usage.output += response.tokenUsage.output;
    }
    for (const { edge, rule, ruleIndex, edgeIndex } of slice) {
      const a = response.answers[`v${edgeIndex}-${ruleIndex}`];
      if (a?.type !== "noul" || a.noul < RULE_VIOLATION_MIN_PROBABILITY) continue;
      result.findings.push({
        type: "anti-pattern",
        pass,
        scope: edge.fromZone,
        text:
          `"${names.get(edge.fromZone) ?? edge.fromZone}" imports "${names.get(edge.toZone) ?? edge.toZone}" on ` +
          `${edge.crossings.length} edge(s), against the project's own rule: ${rule.rule} ` +
          `(${rule.source}: "${rule.quote}")`,
        severity: "warning",
        category: "structural",
        related: [edge.toZone],
        confidence: Math.round(a.noul * 100) / 100,
        anchors: [...new Set(edge.crossings.map((c) => c.from))].slice(0, CROSSINGS_SHOWN).map((file) => ({ file })),
      });
    }
  }

  result.tokenUsage = result.calls > 0 ? usage : undefined;
  if (result.calls > 0) {
    console.log(
      `  [rules] ${classes.length} edge class(es) × ${rules.length} rule(s) in ${result.calls} request(s) — ` +
        `${result.findings.length} violation(s) (${usage.input} in / ${usage.output} out)`,
    );
  }
  return result;
}

/**
 * Extract the rules and check them in one step, for callers that want the
 * whole feature. Silent and free on a repository that declares nothing.
 */
export async function checkDeclaredRules(
  projectDir: string | undefined,
  zones: Zone[],
  crossings: ZoneCrossing[],
  pass: number,
): Promise<RuleCheckResult & { rules: DeclaredRule[] }> {
  const extraction = await extractDeclaredRules(projectDir);
  if (extraction.rules.length === 0) {
    return { findings: [], calls: extraction.calls, tokenUsage: extraction.tokenUsage, asked: 0, rules: [] };
  }
  const checked = await judgeRuleViolations(extraction.rules, zones, crossings, pass);
  const tokenUsage = extraction.tokenUsage || checked.tokenUsage
    ? {
        input: (extraction.tokenUsage?.input ?? 0) + (checked.tokenUsage?.input ?? 0),
        output: (extraction.tokenUsage?.output ?? 0) + (checked.tokenUsage?.output ?? 0),
      }
    : undefined;
  return {
    findings: checked.findings,
    calls: extraction.calls + checked.calls,
    tokenUsage,
    asked: checked.asked,
    rules: extraction.rules,
  };
}
