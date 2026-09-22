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
  TokenUsage,
  Zone,
  ZoneCrossing,
} from "../schema/index.js";
import { ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { askJev, choice, noul, score } from "./jev-client.js";
import type { JevQuestion, JsonValue } from "./jev-client.js";

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

/** Findings per request: two questions each, well inside the request budget. */
const FINDINGS_PER_REQUEST = 40;
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

// ── Shared result shape ──────────────────────────────────────────────────────

export interface JudgeResult {
  findings: Finding[];
  /** Summed over every request this call made; absent when no request was made. */
  tokenUsage?: TokenUsage;
  /** Requests made. */
  calls: number;
}

// ── Findings: severity + category ────────────────────────────────────────────

export interface FindingJudgeRequest {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
}

/**
 * One Score (severity) and one Choice (category) per finding, over one state
 * object. The model is not shown the severity or category the generative pass
 * stated — the judgment is meant to be independent of it.
 */
export function buildFindingJudgeRequest(findings: Finding[]): FindingJudgeRequest {
  const fState: Record<string, JsonValue> = {};
  const questions: Record<string, JevQuestion> = {};
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
  });
  return { state: { findings: fState }, questions };
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
export async function judgeFindings(findings: Finding[]): Promise<JudgeResult> {
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

  for (let start = 0; start < candidates.length; start += FINDINGS_PER_REQUEST) {
    const slice = candidates.slice(start, start + FINDINGS_PER_REQUEST);
    const batch = slice.map(({ f }) => f);
    let response;
    try {
      response = await askJev(buildFindingJudgeRequest(batch));
    } catch (err) {
      if (err instanceof ClaudeClientError) {
        console.warn(`  [judge] finding.judge failed (${err.reason}) — keeping model-stated severities for ${candidates.length - start} finding(s)`);
        break;
      }
      throw err;
    }
    calls++;
    if (response.tokenUsage) {
      usage.input += response.tokenUsage.input;
      usage.output += response.tokenUsage.output;
    }

    batch.forEach((f, i) => {
      const sev = response.answers[`s${i}`];
      const cat = response.answers[`c${i}`];
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
      out[slice[i].index] = next;
      judged++;
    });
  }

  if (calls > 0) {
    console.log(
      `  [judge] finding.judge: ${judged} finding(s) in ${calls} request(s) — ` +
        `${filled} field(s) filled, ${changed} changed (${usage.input} in / ${usage.output} out)`,
    );
  }
  return { findings: out, tokenUsage: calls > 0 ? usage : undefined, calls };
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

type FragilityKind = keyof typeof FRAGILITY;

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
  if (zones.length === 0 || getJudgmentRoute("zone.judge") !== "typesafe") {
    return { findings: [], calls: 0 };
  }

  const findings: Finding[] = [];
  const usage: TokenUsage = { input: 0, output: 0 };
  let calls = 0;

  for (let start = 0; start < zones.length; start += ZONES_PER_REQUEST) {
    const batch = zones.slice(start, start + ZONES_PER_REQUEST);
    const { state, questions, ids } = buildZoneFragilityRequest(batch, crossings);
    let response;
    try {
      response = await askJev({ state, questions });
    } catch (err) {
      if (err instanceof ClaudeClientError) {
        console.warn(`  [judge] zone.judge failed (${err.reason}) — no fragility findings for ${zones.length - start} zone(s)`);
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
      if (answer?.type !== "noul" || answer.noul < ZONE_FRAGILITY_MIN_PROBABILITY) continue;
      findings.push({
        type: "observation",
        pass: passNumber,
        scope: zone.id,
        text: FRAGILITY[kind].text(zone),
        severity: "info",
        category: "structural",
        confidence: round2(answer.noul),
      });
    }
  }

  if (calls > 0) {
    console.log(
      `  [judge] zone.judge: ${zones.length} zone(s) in ${calls} request(s) — ` +
        `${findings.length} fragility finding(s) (${usage.input} in / ${usage.output} out)`,
    );
  }
  return { findings, tokenUsage: calls > 0 ? usage : undefined, calls };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
