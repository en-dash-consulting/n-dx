/**
 * Jev judgments over enrichment output.
 *
 * The generative enrichment prompts produce prose — zone names, descriptions,
 * finding text — and, until now, were also asked to grade that prose: a
 * severity and a category per finding. Those two fields are judgments, not
 * generation, and a text model states them without any signal of how sure it
 * is. Here they are asked of Jev instead, which answers each with a
 * probability distribution and a confidence the pipeline can gate on. The
 * same applies to zone fragility: whether a zone's files belong together is a
 * yes/no judgment over the file list, answered as a probability.
 *
 * Everything here is gated on {@link getJudgmentRoute}: without a route the
 * functions return their input untouched and make no request, so the no-key
 * pipeline is byte-identical to the one before this module existed. Thresholds
 * live in code, not prompts, so changing one needs no re-inference.
 *
 * @module sourcevision/analyzers/enrich-judge
 */

import type {
  Finding,
  FindingCategory,
  FindingType,
  MoveFileFinding,
  TokenUsage,
  Zone,
  ZoneCrossing,
} from "../schema/index.js";
import { dirname } from "node:path";
import { ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { askJev, choice, noul, score } from "./jev-client.js";
import type { JevQuestion, JevResponse, JsonValue } from "./jev-client.js";
import { collectFileHeaders } from "./file-headers.js";

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Minimum Choice/Score confidence for Jev's answer to replace the value the
 * generative model stated (or, for category, the keyword-derived one). Below
 * it the existing value stands and the low confidence is still recorded on the
 * finding, so a reader can see the judgment was contested.
 */
export const FINDING_JUDGE_MIN_CONFIDENCE = 0.5;

/**
 * Minimum Noul probability for a zone-fragility judgment to become a finding.
 * A Noul near 0.5 means "as likely yes as no", which is not worth a line in the
 * report; 0.7 asks for a clear lean before a zone is called out.
 */
export const ZONE_FRAGILITY_MIN_PROBABILITY = 0.7;

/**
 * Support Noul bands. Below the first the finding is dropped: the text model
 * asserted something the evidence (files, headers, crossings) contradicts or
 * cannot show at all — what the old hedge-phrase regex tried to catch from
 * wording alone. Between the two the finding is kept, with the support
 * probability recorded as its confidence when that is lower than the grade's:
 * the text model saw more of the zone than the evidence sample carries, so an
 * undecided Noul is a reason to flag, not to delete. At or above the second
 * the evidence backs it.
 */
export const FINDING_SUPPORT_DROP_BELOW = 0.3;
export const FINDING_SUPPORT_UNCERTAIN_BELOW = 0.7;

/**
 * Probability above which a finding is judged to merely restate a heuristic
 * metric already reported for the same scope, and is dropped as a paraphrase.
 */
export const FINDING_RESTATES_MAX_PROBABILITY = 0.7;

/**
 * Confidence a scope Choice needs before a finding is moved to another zone.
 * Higher than the grade threshold because rescoping changes what the finding
 * is deduplicated and preserved against.
 */
export const FINDING_RESCOPE_MIN_CONFIDENCE = 0.8;

/** Findings per request without evidence: two questions each. */
const FINDINGS_PER_REQUEST = 40;
/** Findings per request with evidence: up to seven questions each plus the zone state. */
const FINDINGS_PER_REQUEST_WITH_EVIDENCE = 20;
/** Candidate anchor files offered per finding; files the text names come first. */
const ANCHOR_CANDIDATE_LIMIT = 100;
/** No-anchor option id. */
const NO_ANCHOR = "none";
/** Scope option for findings about the codebase as a whole. */
const GLOBAL_SCOPE = "global";
/** Zones per request: two Nouls each. */
const ZONES_PER_REQUEST = 25;
/** File paths included per zone; enough to see the shape without the whole list. */
const ZONE_FILE_SAMPLE = 40;

// ── Criteria ─────────────────────────────────────────────────────────────────

const SEVERITY_LEVELS = ["info", "warning", "critical"] as const;

/** Score levels, lowest first. Each describes a situation, not a degree. */
const SEVERITY_CRITERIA: JsonValue[] = [
  {
    what: "An observation with no action implied. The code works as intended and nothing needs to change; this is context or praise.",
    examples: ["Zone X cleanly separates parsing from rendering.", "The CLI layer has no upward imports."],
  },
  {
    what: "A maintainability or boundary problem that will cost time if left as is, but nothing is broken today.",
    examples: ["Two zones each re-implement the same path normalisation.", "A viewer component imports directly from the server package."],
  },
  {
    what: "A defect, data-loss or security exposure that needs fixing now.",
    examples: ["The lock is released before the write completes, so concurrent writers drop items.", "API keys are written to the shared, git-tracked config file."],
  },
];

/** Drawn from the doc comment on `FindingCategory` in schema/v1.ts. */
const CATEGORY_CRITERIA: Record<FindingCategory, JsonValue> = {
  structural: {
    what: "An opinion about zone boundaries, module placement, or layering — where code lives and what depends on what.",
    not_for: "A defect in the code itself, or a naming and documentation remark.",
  },
  code: {
    what: "A real problem in the code itself: a bug, duplication, dead code, or a logic or concurrency error.",
    not_for: "Where a module lives, or how it is named and documented.",
  },
  documentation: {
    what: "Naming, conventions, comments, or missing or stale documentation.",
    not_for: "The behaviour of the code or the placement of modules.",
  },
};

const CATEGORY_IDS = Object.keys(CATEGORY_CRITERIA) as FindingCategory[];

/** Selectable finding types; `move-file` is emitted by code, never by a judgment. */
const TYPE_CRITERIA: Record<Exclude<FindingType, "move-file">, string> = {
  observation: "A neutral statement of what the code does or how it is arranged.",
  pattern: "A recurring structure or convention seen across several files or zones.",
  relationship: "How two or more zones or files depend on or interact with each other.",
  "anti-pattern": "A structure that works against maintainability, correctness, or the project's own conventions.",
  suggestion: "A concrete change the author of the finding recommends making.",
};
const TYPE_IDS = Object.keys(TYPE_CRITERIA) as FindingType[];

// ── Shared result shape ──────────────────────────────────────────────────────

export interface JudgeResult {
  findings: Finding[];
  /** Summed over every request this call made; absent when no request was made. */
  tokenUsage?: TokenUsage;
  /** Requests made. */
  calls: number;
  /** Findings removed as unsupported or as metric paraphrases. */
  dropped?: number;
}

/**
 * What a finding is judged against. Supplying it adds the support, restates,
 * anchor, type and scope questions; without it only severity and category are
 * asked (the shape the meta pass re-rating uses).
 */
export interface FindingEvidence {
  zones: Zone[];
  crossings?: ZoneCrossing[];
  /** Pass 0 heuristic findings; a finding that only restates one is dropped. */
  heuristics?: Finding[];
  /** Enables file headers in the evidence; without it only paths are shown. */
  projectDir?: string;
}

// ── Findings: severity + category ────────────────────────────────────────────

export interface FindingJudgeRequest {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
  /** question id → anchor option id → file path (anchor questions only). */
  anchorFiles: Map<string, string[]>;
}

/** The evidence state for the zones a set of scopes names: file sample, headers, imports. */
function buildZoneEvidence(scopes: string[], evidence: FindingEvidence): Record<string, JsonValue> {
  const zonesById = new Map(evidence.zones.map((z) => [z.id, z]));
  const crossingCounts = new Map<string, Record<string, number>>();
  for (const c of evidence.crossings ?? []) {
    const out = crossingCounts.get(c.fromZone) ?? {};
    out[c.toZone] = (out[c.toZone] ?? 0) + 1;
    crossingCounts.set(c.fromZone, out);
  }
  const zoneState: Record<string, JsonValue> = {};
  for (const id of new Set(scopes.filter((s) => zonesById.has(s)))) {
    const zone = zonesById.get(id)!;
    zoneState[id] = {
      name: zone.name,
      fileCount: zone.files.length,
      files: zone.files.slice(0, ZONE_FILE_SAMPLE),
      headers: collectFileHeaders(zone.files.slice(0, ZONE_FILE_SAMPLE), evidence.projectDir),
      importsTo: crossingCounts.get(id) ?? {},
    };
  }
  return zoneState;
}

/**
 * One Score (severity) and one Choice (category) per finding, over one state
 * object. The model is not shown the severity or category the generative pass
 * stated — the judgment is meant to be independent of it.
 *
 * With {@link FindingEvidence}, the state also carries each zone's file sample,
 * leading comments, and crossing counts, plus the heuristic findings per
 * scope, and every finding gains: a support Noul, a restates-metric Noul
 * (only when the scope has heuristics), an anchor Choice over the scope's
 * files, a type Choice and a scope Choice. All are independent, so one request.
 */
export function buildFindingJudgeRequest(
  findings: Finding[],
  evidence?: FindingEvidence,
): FindingJudgeRequest {
  const fState: Record<string, JsonValue> = {};
  const questions: Record<string, JevQuestion> = {};
  const anchorFiles = new Map<string, string[]>();

  // Evidence state, shared by every finding in the batch.
  const zonesById = new Map((evidence?.zones ?? []).map((z) => [z.id, z]));
  const heuristicsByScope = new Map<string, string[]>();
  for (const h of evidence?.heuristics ?? []) {
    const list = heuristicsByScope.get(h.scope) ?? [];
    list.push(h.text);
    heuristicsByScope.set(h.scope, list);
  }
  const zoneState: Record<string, JsonValue> = evidence
    ? buildZoneEvidence(findings.map((f) => f.scope), evidence)
    : {};
  const scopeCriteria: Record<string, JsonValue> = {};
  if (evidence) {
    for (const z of evidence.zones) scopeCriteria[z.id] = `${z.name}: ${z.files.length} files`;
    scopeCriteria[GLOBAL_SCOPE] = "About the codebase as a whole, not one zone.";
  }

  findings.forEach((f, i) => {
    const id = `f${i}`;
    fState[id] = {
      text: f.text,
      type: f.type,
      scope: f.scope,
      related: f.related ?? [],
    };
    questions[`s${i}`] = score(
      `How severe is finding \`findings.${id}\` for the codebase it describes?`,
      SEVERITY_CRITERIA,
    );
    questions[`c${i}`] = choice(
      `Which kind of finding is \`findings.${id}\`?`,
      CATEGORY_CRITERIA as Record<string, JsonValue>,
    );
    if (!evidence) return;

    const zone = zonesById.get(f.scope);
    const evidenceRef = zone ? `\`zones.${f.scope}\` (its files, their leading comments, and its imports)` : "the zone list";
    questions[`v${i}`] = noul(
      `Is finding \`findings.${id}\` supported by the evidence in ${evidenceRef}? Answer no if it asserts something the evidence does not show, or hedges with "if" or "might" instead of observing.`,
    );
    const heuristics = heuristicsByScope.get(f.scope);
    if (heuristics && heuristics.length > 0) {
      questions[`r${i}`] = noul(
        `Does \`findings.${id}\` merely restate a fact or metric already listed in \`heuristics.${f.scope}\`, adding no new observation?`,
      );
    }
    if (zone) {
      const named = zone.files.filter((p) => f.text.includes(p) || (f.related ?? []).includes(p));
      const rest = zone.files.filter((p) => !named.includes(p));
      const candidates = [...named, ...rest].slice(0, ANCHOR_CANDIDATE_LIMIT);
      const anchorCriteria: Record<string, JsonValue> = {};
      candidates.forEach((p, k) => { anchorCriteria[`a${k}`] = p; });
      anchorCriteria[NO_ANCHOR] = "No single file in this zone is what the finding is about.";
      anchorFiles.set(`a${i}`, candidates);
      questions[`a${i}`] = choice(
        `Which file in \`zones.${f.scope}\` is finding \`findings.${id}\` primarily about?`,
        anchorCriteria,
      );
    }
    questions[`t${i}`] = choice(`What kind of statement is \`findings.${id}\`?`, TYPE_CRITERIA as Record<string, JsonValue>);
    questions[`z${i}`] = choice(`Which zone is \`findings.${id}\` about?`, scopeCriteria);
  });

  const state: Record<string, JsonValue> = { findings: fState };
  if (evidence) {
    state.zones = zoneState;
    state.heuristics = Object.fromEntries(heuristicsByScope);
  }
  return { state, questions, anchorFiles };
}

/**
 * Ask Jev to grade each finding's severity and category. Jev's value replaces
 * a stated one only where its confidence clears
 * {@link FINDING_JUDGE_MIN_CONFIDENCE}; where nothing was stated — the judged
 * prompts no longer ask the text model for either field — Jev's best answer
 * fills the gap at any confidence, because an unsure grade beats no grade and
 * the confidence is recorded beside it. `confidence` is set on every judged
 * finding from the severity answer, the one that gates action.
 *
 * Runs before `enforceSeverityRules`, which still has the last word.
 */
export async function judgeFindings(
  findings: Finding[],
  evidence?: FindingEvidence,
): Promise<JudgeResult> {
  if (findings.length === 0 || getJudgmentRoute("finding.judge") !== "typesafe") {
    return { findings, calls: 0 };
  }

  // Pass 0 findings come from deterministic heuristics whose severities are
  // calibrated by code thresholds — the same rule enforceSeverityRules
  // follows. They are left exactly as they are and never sent.
  const out = [...findings];
  const candidates = findings
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.pass >= 1);
  if (candidates.length === 0) return { findings, calls: 0 };

  const usage: TokenUsage = { input: 0, output: 0 };
  let calls = 0;
  let judged = 0;
  let filled = 0;
  let changed = 0;
  let unsupported = 0;
  let uncertain = 0;
  let paraphrased = 0;
  let anchored = 0;
  let skipped = 0;
  const dropIndexes = new Set<number>();

  /** Apply one batch's answers to `out`. */
  const apply = (slice: Array<{ f: Finding; index: number }>, request: FindingJudgeRequest, answers: JevResponse["answers"]): void => {
    slice.forEach(({ f, index }, i) => {
      const sev = answers[`s${i}`];
      const cat = answers[`c${i}`];
      let next: Finding = f;
      if (sev?.type === "score") {
        next = { ...next, confidence: round2(sev.confidence) };
        const level = Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, Math.round(sev.score)));
        const severity = SEVERITY_LEVELS[level];
        if (f.severity === undefined) {
          next = { ...next, severity };
          filled++;
        } else if (sev.confidence >= FINDING_JUDGE_MIN_CONFIDENCE && severity !== f.severity) {
          next = { ...next, severity };
          changed++;
        }
      }
      if (cat?.type === "choice" && (CATEGORY_IDS as string[]).includes(cat.choice)) {
        const category = cat.choice as FindingCategory;
        if (f.category === undefined) {
          next = { ...next, category };
          filled++;
        } else if (cat.confidence >= FINDING_JUDGE_MIN_CONFIDENCE && category !== f.category) {
          next = { ...next, category };
          changed++;
        }
      }

      // Evidence questions. A drop wins over every other answer.
      const support = answers[`v${i}`];
      if (support?.type === "noul") {
        if (support.noul < FINDING_SUPPORT_DROP_BELOW) {
          dropIndexes.add(index);
          unsupported++;
          return;
        }
        if (support.noul < FINDING_SUPPORT_UNCERTAIN_BELOW) {
          next = { ...next, confidence: Math.min(next.confidence ?? 1, round2(support.noul)) };
          uncertain++;
        }
      }
      const restates = answers[`r${i}`];
      if (restates?.type === "noul" && restates.noul >= FINDING_RESTATES_MAX_PROBABILITY) {
        dropIndexes.add(index);
        paraphrased++;
        return;
      }
      const anchor = answers[`a${i}`];
      const anchorCandidates = request.anchorFiles.get(`a${i}`);
      if (anchor?.type === "choice" && anchorCandidates && anchor.choice !== NO_ANCHOR) {
        const k = Number(anchor.choice.slice(1));
        const file = anchorCandidates[k];
        if (file) {
          next = { ...next, anchors: [{ file }] };
          anchored++;
        }
      }
      const type = answers[`t${i}`];
      if (type?.type === "choice" && (TYPE_IDS as string[]).includes(type.choice) && type.confidence >= FINDING_JUDGE_MIN_CONFIDENCE) {
        next = { ...next, type: type.choice as FindingType };
      }
      const scope = answers[`z${i}`];
      if (scope?.type === "choice" && scope.confidence >= FINDING_RESCOPE_MIN_CONFIDENCE && scope.choice !== f.scope) {
        const valid = scope.choice === GLOBAL_SCOPE || (evidence?.zones ?? []).some((z) => z.id === scope.choice);
        if (valid) next = { ...next, scope: scope.choice };
      }

      out[index] = next;
      judged++;
    });
  };

  /**
   * Judge one batch; on a non-auth failure split it and try each half, so a
   * transient error or one bad question costs at most one finding its
   * judgment rather than every finding after it. Returns false on auth.
   */
  const judgeBatch = async (slice: Array<{ f: Finding; index: number }>): Promise<boolean> => {
    const request = buildFindingJudgeRequest(slice.map(({ f }) => f), evidence);
    try {
      const response = await askJev(request, { taskClass: "finding.judge" });
      calls++;
      if (response.tokenUsage) {
        usage.input += response.tokenUsage.input;
        usage.output += response.tokenUsage.output;
      }
      apply(slice, request, response.answers);
      return true;
    } catch (err) {
      if (!(err instanceof ClaudeClientError)) throw err;
      if (err.reason === "auth") {
        console.warn(`  [judge] finding.judge failed (auth) — keeping model-stated severities: ${err.message.slice(0, 200)}`);
        return false;
      }
      if (slice.length > 1) {
        const mid = Math.ceil(slice.length / 2);
        console.warn(`  [judge] finding.judge batch of ${slice.length} failed (${err.reason}) — retrying as two halves: ${err.message.slice(0, 160)}`);
        const first = await judgeBatch(slice.slice(0, mid));
        if (!first) return false;
        return judgeBatch(slice.slice(mid));
      }
      skipped++;
      console.warn(`  [judge] finding.judge could not judge one finding (${err.reason}) — kept as stated: ${err.message.slice(0, 160)}`);
      return true;
    }
  };

  const perRequest = evidence ? FINDINGS_PER_REQUEST_WITH_EVIDENCE : FINDINGS_PER_REQUEST;
  for (let start = 0; start < candidates.length; start += perRequest) {
    const ok = await judgeBatch(candidates.slice(start, start + perRequest));
    if (!ok) break;
  }

  if (calls > 0) {
    const evidenceNote = evidence
      ? `, ${unsupported} unsupported + ${paraphrased} paraphrase dropped, ${uncertain} kept with low support, ${anchored} anchored`
      : "";
    const skippedNote = skipped > 0 ? `, ${skipped} skipped` : "";
    console.log(
      `  [judge] finding.judge: ${judged + unsupported + paraphrased} finding(s) in ${calls} request(s) — ` +
        `${filled} field(s) filled, ${changed} changed${evidenceNote}${skippedNote} (${usage.input} in / ${usage.output} out)`,
    );
  }
  const kept = dropIndexes.size > 0 ? out.filter((_, i) => !dropIndexes.has(i)) : out;
  return {
    findings: kept,
    tokenUsage: calls > 0 ? usage : undefined,
    calls,
    ...(dropIndexes.size > 0 ? { dropped: dropIndexes.size } : {}),
  };
}

// ── Zones: fragility ─────────────────────────────────────────────────────────

/** The two fragility conditions, with the finding text each becomes. */
const FRAGILITY = {
  unrelated: {
    prefix: "u",
    instructions: (id: string) =>
      `Do the files in \`zones.${id}\` serve unrelated purposes — would a maintainer expect them to live in separate modules?`,
    text: (zone: Zone) =>
      `Files in zone "${zone.name}" appear to serve unrelated purposes; a maintainer would expect them in separate modules.`,
  },
  overdependent: {
    prefix: "d",
    instructions: (id: string) =>
      `Does \`zones.${id}\` depend on more of the rest of the codebase than a module of its size and purpose should?`,
    text: (zone: Zone) =>
      `Zone "${zone.name}" depends on more of the rest of the codebase than a module of its size and purpose warrants.`,
  },
} as const;

export type FragilityKind = keyof typeof FRAGILITY;

export interface ZoneFragilityRequest {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
  /** question id → the zone and condition it asks about. */
  ids: Map<string, { zone: Zone; kind: FragilityKind }>;
}

/**
 * Two Nouls per zone over its file sample, metrics, and crossing counts. The
 * Louvain cohesion/coupling numbers are included as facts, not as the answer:
 * the question is the architectural judgment those numbers approximate.
 */
export function buildZoneFragilityRequest(
  zones: Zone[],
  crossings: ZoneCrossing[],
): ZoneFragilityRequest {
  const importsTo = new Map<string, Record<string, number>>();
  const importedFrom = new Map<string, Record<string, number>>();
  for (const c of crossings) {
    const out = importsTo.get(c.fromZone) ?? {};
    out[c.toZone] = (out[c.toZone] ?? 0) + 1;
    importsTo.set(c.fromZone, out);
    const inn = importedFrom.get(c.toZone) ?? {};
    inn[c.fromZone] = (inn[c.fromZone] ?? 0) + 1;
    importedFrom.set(c.toZone, inn);
  }

  const zState: Record<string, JsonValue> = {};
  const questions: Record<string, JevQuestion> = {};
  const ids = new Map<string, { zone: Zone; kind: FragilityKind }>();
  zones.forEach((zone, i) => {
    const id = `z${i}`;
    zState[id] = {
      id: zone.id,
      name: zone.name,
      description: zone.description,
      fileCount: zone.files.length,
      files: zone.files.slice(0, ZONE_FILE_SAMPLE),
      cohesion: zone.cohesion,
      coupling: zone.coupling,
      importsTo: importsTo.get(zone.id) ?? {},
      importedFrom: importedFrom.get(zone.id) ?? {},
    };
    for (const kind of Object.keys(FRAGILITY) as FragilityKind[]) {
      const qid = `${FRAGILITY[kind].prefix}${i}`;
      questions[qid] = noul(FRAGILITY[kind].instructions(id));
      ids.set(qid, { zone, kind });
    }
  });
  return { state: { zones: zState }, questions, ids };
}

/** Raw fragility probabilities per zone, for callers that band them. */
export interface ZoneFragilityAssessment {
  /** zone id → probability per condition; zones with no answer are absent. */
  probabilities: Map<string, Partial<Record<FragilityKind, number>>>;
  tokenUsage?: TokenUsage;
  calls: number;
}

/**
 * Ask Jev the two fragility Nouls for each zone and return the raw
 * probabilities. Inert without a `zone.judge` route.
 */
export async function assessZoneFragility(
  zones: Zone[],
  crossings: ZoneCrossing[],
): Promise<ZoneFragilityAssessment> {
  const probabilities = new Map<string, Partial<Record<FragilityKind, number>>>();
  if (zones.length === 0 || getJudgmentRoute("zone.judge") !== "typesafe") {
    return { probabilities, calls: 0 };
  }
  const usage: TokenUsage = { input: 0, output: 0 };
  let calls = 0;

  for (let start = 0; start < zones.length; start += ZONES_PER_REQUEST) {
    const batch = zones.slice(start, start + ZONES_PER_REQUEST);
    const { state, questions, ids } = buildZoneFragilityRequest(batch, crossings);
    let response;
    try {
      response = await askJev({ state, questions }, { taskClass: "zone.judge" });
    } catch (err) {
      if (err instanceof ClaudeClientError) {
        console.warn(`  [judge] zone.judge failed (${err.reason}) — no fragility judgment for ${zones.length - start} zone(s)`);
        break;
      }
      throw err;
    }
    calls++;
    if (response.tokenUsage) {
      usage.input += response.tokenUsage.input;
      usage.output += response.tokenUsage.output;
    }
    for (const [qid, { zone, kind }] of ids) {
      const answer = response.answers[qid];
      if (answer?.type !== "noul") continue;
      const entry = probabilities.get(zone.id) ?? {};
      entry[kind] = round2(answer.noul);
      probabilities.set(zone.id, entry);
    }
  }
  return { probabilities, tokenUsage: calls > 0 ? usage : undefined, calls };
}

/** Findings for every fragility probability at or above the threshold. */
export function fragilityFindings(
  zones: Zone[],
  assessment: ZoneFragilityAssessment,
  passNumber: number,
): Finding[] {
  const findings: Finding[] = [];
  for (const zone of zones) {
    const probs = assessment.probabilities.get(zone.id);
    if (!probs) continue;
    for (const kind of Object.keys(FRAGILITY) as FragilityKind[]) {
      const p = probs[kind];
      if (p === undefined || p < ZONE_FRAGILITY_MIN_PROBABILITY) continue;
      findings.push({
        type: "observation",
        pass: passNumber,
        scope: zone.id,
        text: FRAGILITY[kind].text(zone),
        severity: "info",
        category: "structural",
        confidence: p,
      });
    }
  }
  return findings;
}

/**
 * Ask Jev whether each zone is fragile. Every Noul at or above
 * {@link ZONE_FRAGILITY_MIN_PROBABILITY} becomes a pass-scoped structural
 * observation carrying the probability as its confidence. Text is fixed per
 * zone and condition so `deduplicateFindings` merges repeats across passes.
 */
export async function judgeZoneFragility(
  zones: Zone[],
  crossings: ZoneCrossing[],
  passNumber: number,
): Promise<JudgeResult> {
  const assessment = await assessZoneFragility(zones, crossings);
  const findings = fragilityFindings(zones, assessment, passNumber);
  if (assessment.calls > 0) {
    const u = assessment.tokenUsage ?? { input: 0, output: 0 };
    console.log(
      `  [judge] zone.judge: ${zones.length} zone(s) in ${assessment.calls} request(s) — ` +
        `${findings.length} fragility finding(s) (${u.input} in / ${u.output} out)`,
    );
  }
  return { findings, tokenUsage: assessment.tokenUsage, calls: assessment.calls };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


// ── Heuristic findings: real problem or detection artifact? ─────────────────

/**
 * Bands for the pass 0 judgment. Pass 0 severities are calibrated by global
 * thresholds (`enforceSeverityRules` never touches them); this is the one
 * deliberate exception, because Jev sees the specific files a threshold
 * cannot: a residual cluster, a pinned directory, a test tree counted as
 * source. At or below the first band the finding is demoted to `info`;
 * between them its confidence is recorded; at or above the second it stands.
 */
export const HEURISTIC_ARTIFACT_MAX_PROBABILITY = 0.3;
export const HEURISTIC_REAL_MIN_PROBABILITY = 0.7;

/**
 * Ask Jev, per zone-scoped pass 0 finding at `warning` or above, whether it
 * describes a real problem. Move-file findings are left to {@link judgeMoves}.
 */
export async function judgeHeuristicFindings(
  findings: Finding[],
  evidence: FindingEvidence,
): Promise<JudgeResult> {
  const zoneIds = new Set(evidence.zones.map((z) => z.id));
  const candidates = findings
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.pass === 0 && f.type !== "move-file" && (f.severity === "warning" || f.severity === "critical") && zoneIds.has(f.scope));
  if (candidates.length === 0 || getJudgmentRoute("finding.judge") !== "typesafe") {
    return { findings, calls: 0 };
  }

  const out = [...findings];
  const usage: TokenUsage = { input: 0, output: 0 };
  let calls = 0;
  let demoted = 0;
  let uncertain = 0;

  for (let start = 0; start < candidates.length; start += FINDINGS_PER_REQUEST_WITH_EVIDENCE) {
    const slice = candidates.slice(start, start + FINDINGS_PER_REQUEST_WITH_EVIDENCE);
    const fState: Record<string, JsonValue> = {};
    const questions: Record<string, JevQuestion> = {};
    slice.forEach(({ f }, i) => {
      fState[`f${i}`] = { text: f.text, type: f.type, scope: f.scope, related: f.related ?? [] };
      questions[`h${i}`] = noul(
        `Given the files in \`zones.${f.scope}\`, does \`findings.f${i}\` describe a real maintainability problem, rather than an artifact of how zones were detected (a residual cluster, a pinned directory, a build or test tree counted as source, a metric that is high by design for this kind of module)?`,
      );
    });
    const state: JsonValue = { findings: fState, zones: buildZoneEvidence(slice.map(({ f }) => f.scope), evidence) };
    let response;
    try {
      response = await askJev({ state, questions }, { taskClass: "finding.judge" });
    } catch (err) {
      if (!(err instanceof ClaudeClientError)) throw err;
      console.warn(`  [judge] heuristic judgment failed (${err.reason}) — keeping calibrated severities: ${err.message.slice(0, 160)}`);
      break;
    }
    calls++;
    if (response.tokenUsage) {
      usage.input += response.tokenUsage.input;
      usage.output += response.tokenUsage.output;
    }
    slice.forEach(({ f, index }, i) => {
      const a = response.answers[`h${i}`];
      if (a?.type !== "noul") return;
      const p = round2(a.noul);
      if (p <= HEURISTIC_ARTIFACT_MAX_PROBABILITY) {
        out[index] = { ...f, severity: "info", confidence: p };
        demoted++;
      } else {
        out[index] = { ...f, confidence: p };
        if (p < HEURISTIC_REAL_MIN_PROBABILITY) uncertain++;
      }
    });
  }

  if (calls > 0) {
    console.log(
      `  [judge] heuristic findings: ${candidates.length} judged in ${calls} request(s) — ` +
        `${demoted} demoted to info, ${uncertain} kept with low confidence (${usage.input} in / ${usage.output} out)`,
    );
  }
  return { findings: out, tokenUsage: calls > 0 ? usage : undefined, calls };
}

// ── Moves: which zone should this file live in? ──────────────────────────────

/** A move is emitted only when the Choice lands on another zone this confidently. */
export const MOVE_MIN_PROBABILITY = 0.7;
/** Files with fewer cross-zone edges than this are not asked about. */
const MOVE_CANDIDATE_MIN_EDGES = 3;
/** Files asked about per run, most cross-zone edges first. */
const MOVE_CANDIDATES_MAX = 40;
const STAY = "stay";

/** Most common directory among a zone's files. */
function majorityDirectory(zone: Zone): string {
  const counts = new Map<string, number>();
  for (const f of zone.files) {
    const d = dirname(f);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ".";
}

export interface MoveJudgeRequest {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
  /** question id → the file, its zone, and its edge counts per partner zone. */
  ids: Map<string, { path: string; zoneId: string; edges: Record<string, number> }>;
}

/**
 * Candidates are the files with the most cross-zone edges; each gets a Choice
 * over its own zone, the zones it exchanges edges with, and `stay`.
 */
export function buildMoveJudgeRequest(zones: Zone[], crossings: ZoneCrossing[]): MoveJudgeRequest {
  const zoneOf = new Map<string, string>();
  for (const z of zones) for (const f of z.files) zoneOf.set(f, z.id);
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  const edges = new Map<string, Record<string, number>>();
  const bump = (file: string, partner: string) => {
    const e = edges.get(file) ?? {};
    e[partner] = (e[partner] ?? 0) + 1;
    edges.set(file, e);
  };
  for (const c of crossings) {
    bump(c.from, c.toZone);
    bump(c.to, c.fromZone);
  }
  const ranked = [...edges.entries()]
    .map(([path, e]) => ({ path, e, total: Object.values(e).reduce((a, b) => a + b, 0) }))
    .filter((x) => x.total >= MOVE_CANDIDATE_MIN_EDGES && zoneOf.has(x.path))
    .sort((a, b) => b.total - a.total)
    .slice(0, MOVE_CANDIDATES_MAX);

  const fState: Record<string, JsonValue> = {};
  const zState: Record<string, JsonValue> = {};
  const questions: Record<string, JevQuestion> = {};
  const ids = new Map<string, { path: string; zoneId: string; edges: Record<string, number> }>();
  const describe = (id: string) => {
    if (zState[id]) return;
    const z = zonesById.get(id);
    if (!z) return;
    zState[id] = { name: z.name, fileCount: z.files.length, directory: majorityDirectory(z), files: z.files.slice(0, 12) };
  };
  ranked.forEach(({ path, e }, i) => {
    const zoneId = zoneOf.get(path)!;
    const partners = Object.keys(e).filter((id) => id !== zoneId && zonesById.has(id));
    if (partners.length === 0) return;
    const id = `f${i}`;
    fState[id] = { path, zone: zoneId, edgesToZones: e };
    describe(zoneId);
    for (const pz of partners) describe(pz);
    const criteria: Record<string, JsonValue> = {};
    for (const zid of [zoneId, ...partners]) {
      const z = zonesById.get(zid)!;
      criteria[zid] = `${z.name} (${majorityDirectory(z)}/, ${z.files.length} files)`;
    }
    criteria[STAY] = "The file is where it belongs; its cross-zone imports are expected for what it does.";
    questions[`m${i}`] = choice(
      `Which zone should the file \`files.${id}\` live in, judging by what it does and where its imports go? Its current zone is \`files.${id}.zone\`.`,
      criteria,
    );
    ids.set(`m${i}`, { path, zoneId, edges: e });
  });
  return { state: { files: fState, zones: zState }, questions, ids };
}

/**
 * Ask Jev where the most cross-linked files belong. A confident answer for a
 * different zone becomes a `move-file` finding with `moveReason:
 * "zone-judgment"`, the target zone's majority directory as `to`, and the
 * file's edges into that zone as the predicted impact.
 */
export async function judgeMoves(
  zones: Zone[],
  crossings: ZoneCrossing[],
  passNumber: number,
): Promise<JudgeResult> {
  if (zones.length === 0 || getJudgmentRoute("zone.judge") !== "typesafe") {
    return { findings: [], calls: 0 };
  }
  const { state, questions, ids } = buildMoveJudgeRequest(zones, crossings);
  if (ids.size === 0) return { findings: [], calls: 0 };

  let response;
  try {
    response = await askJev({ state, questions }, { taskClass: "zone.judge" });
  } catch (err) {
    if (!(err instanceof ClaudeClientError)) throw err;
    console.warn(`  [judge] move judgment failed (${err.reason}) — no judged moves: ${err.message.slice(0, 160)}`);
    return { findings: [], calls: 0 };
  }
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  const findings: Finding[] = [];
  let stays = 0;
  for (const [qid, { path, zoneId, edges }] of ids) {
    const a = response.answers[qid];
    if (a?.type !== "choice") continue;
    if (a.choice === STAY || a.choice === zoneId) {
      stays++;
      continue;
    }
    const p = a.probabilities[a.choice] ?? 0;
    const target = zonesById.get(a.choice);
    if (!target || p < MOVE_MIN_PROBABILITY) continue;
    const toDir = majorityDirectory(target);
    const impact = edges[a.choice] ?? 0;
    const move: MoveFileFinding = {
      type: "move-file",
      pass: passNumber,
      scope: zoneId,
      text: `File "${path}" belongs with ${target.name}: ${impact} of its cross-zone imports go there — consider moving it to ${toDir}/`,
      severity: "info",
      category: "structural",
      related: [a.choice],
      confidence: round2(p),
      from: path,
      to: `${toDir}/`,
      moveReason: "zone-judgment",
      predictedImpact: impact,
    };
    findings.push(move);
  }
  console.log(
    `  [judge] moves: ${ids.size} file(s) judged — ${findings.length} move(s), ${stays} stay ` +
      `(${response.tokenUsage?.input ?? 0} in / ${response.tokenUsage?.output ?? 0} out)`,
  );
  return { findings, tokenUsage: response.tokenUsage, calls: 1 };
}
