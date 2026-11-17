/**
 * What a re-run has to decide, decided by judgment instead of by hash.
 *
 * Two questions are asked of every re-run, and until now both were answered
 * mechanically and bluntly in opposite directions:
 *
 * - **Does this zone's narrative need refreshing?** Answered by
 *   `structureHash` — the file list. A refactor that keeps the file list
 *   re-narrates nothing; nothing else re-narrates either.
 * - **Does this previously-found finding still hold?** Answered by the zone's
 *   content hash in `zones.ts` `assembleFindings`. One comment edit changes the
 *   hash and drops every AI finding in the zone.
 *
 * Both are judgments over a delta, which is what Jev answers. The hashes stay
 * as the **pre-filter**: an unchanged hash asks no question and costs nothing,
 * so a no-op re-run is still free. Only zones that moved are put to the Noul,
 * and both Nouls go in one merged request per batch over one shared state, so
 * a finding references `zones.<id>` the same way the support judgment does.
 *
 * ## What the delta can and cannot show
 *
 * Files added and removed, cohesion/coupling deltas and crossing deltas are all
 * exact: both runs' zone records carry them. Per-file "this file's leading
 * comment changed" is not — nothing stores the previous run's headers, and
 * storing one per file would roughly double `zones.json`. Instead each zone
 * carries a {@link Zone.headerHash} over the same file sample the judgments
 * see, so the delta can say whether the files' *stated purposes* moved along
 * with their content, and the current headers travel as evidence. That is the
 * distinction the motivating case needs: a comment edit changes both hashes, a
 * body edit changes only the content hash.
 *
 * ## Where the resolved findings are logged
 *
 * A dropped finding is written to `<svDir>/.cache/rerun-log.jsonl` in the shape
 * rex's `append_log` uses (`timestamp`, `event`, `detail`), **not** to
 * `.rex/execution-log.jsonl`: that file has a single writer, rex, under the
 * `.rex/` write-access protocol (PACKAGE_GUIDELINES.md), and sourcevision is a
 * sibling domain package that may neither import rex nor write its files.
 *
 * Inert without a judgment route, like every other module here: with no route
 * the verdicts are empty, the callers fall back to the hash rules, and the
 * no-key pipeline is the one that existed before this module.
 *
 * @module sourcevision/analyzers/rerun-judge
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding, RerunSummary, Zone, ZoneCrossing, Zones } from "../schema/index.js";
import { ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { askJev, noul } from "@n-dx/llm-client";
import type { JevQuestion, JsonValue } from "@n-dx/llm-client";
import { collectFileHeaders, extractFileHeader } from "./file-headers.js";
import { SV_CACHE_DIRNAME } from "../paths.js";
import { addCallTokens } from "./token-usage.js";

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * At or above this, the change alters what a maintainer would say about the
 * zone and it is re-narrated (it joins the cascade's escalation set).
 */
export const RERUN_REFRESH_MIN_PROBABILITY = 0.7;

/**
 * At or below this, the previous insights stand untouched. Between the two the
 * zone is still not re-narrated — a maybe is not worth a 20–30 s text-model
 * call — but it is named in the run record so a reader knows its description
 * was not freshly confirmed.
 */
export const RERUN_KEEP_MAX_PROBABILITY = 0.3;

/** At or above this, a previously-judged finding is carried forward as it was. */
export const FINDING_HOLDS_MIN_PROBABILITY = 0.7;

/**
 * Below this the finding is dropped as resolved. Between the two it is carried
 * with its `confidence` lowered to the probability: the evidence sample is
 * smaller than what the text model saw when it wrote the finding, so an
 * undecided Noul is a reason to flag, not to delete — the same reasoning as
 * the support band in `enrich-judge.ts`.
 */
export const FINDING_HOLDS_DROP_BELOW = 0.3;

/** Zones per request. Each carries its delta, headers and previous narrative. */
const ZONES_PER_REQUEST = 12;
/** Files sampled per zone, matching `enrich-judge.ts`'s `ZONE_FILE_SAMPLE`. */
const ZONE_FILE_SAMPLE = 40;
/** Previous insights and findings shown per zone. */
const PREVIOUS_ITEMS_PER_ZONE = 8;

// ── Header hash ──────────────────────────────────────────────────────────────

/**
 * Hash of the leading doc comments of a zone's sampled files.
 *
 * Only the sample, so the hash is computed over exactly what a judgment is
 * shown — a header outside the sample moving is invisible to the judgment and
 * so must be invisible here too, or the delta would claim evidence it never
 * presented.
 */
export function computeZoneHeaderHash(zone: Zone, projectDir: string | undefined): string {
  if (!projectDir) return "";
  const parts: string[] = [];
  for (const rel of zone.files.slice(0, ZONE_FILE_SAMPLE)) {
    parts.push(`${rel}\u0000${extractFileHeader(join(projectDir, rel)) ?? ""}`);
  }
  return createHash("sha256").update(parts.join("\u0001")).digest("hex").slice(0, 16);
}

// ── Deltas ───────────────────────────────────────────────────────────────────

/** What moved in one zone since the previous run. */
export interface ZoneDelta {
  zone: Zone;
  previous: Zone;
  filesAdded: string[];
  filesRemoved: string[];
  /** The zone's files' contents moved (previous vs current `zoneContentHashes`). */
  contentChanged: boolean;
  /** The sampled files' leading comments moved with them. */
  headersChanged: boolean;
  /** Partner zone id → change in the number of imports exchanged. */
  crossingsDelta: Record<string, number>;
  cohesionDelta: number;
  couplingDelta: number;
}

/** Imports exchanged with each partner zone, both directions folded together. */
function crossingCounts(zoneId: string, crossings: ZoneCrossing[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of crossings) {
    const partner = c.fromZone === zoneId ? c.toZone : c.toZone === zoneId ? c.fromZone : undefined;
    if (partner === undefined || partner === zoneId) continue;
    out[partner] = (out[partner] ?? 0) + 1;
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ZoneDeltaInput {
  /** Current zone, paired with the previous zone it continues. */
  pairs: Array<{ zone: Zone; previous: Zone }>;
  currentCrossings: ZoneCrossing[];
  previousZones: Zones | undefined;
  /** Current per-zone content hashes, keyed by the *current* zone ids. */
  contentHashes: Record<string, string>;
  projectDir?: string;
}

/**
 * Deltas for the zones whose content or header hash moved. A zone whose hashes
 * both match the previous run is omitted: that is the pre-filter, and it is why
 * a no-op re-run asks nothing.
 */
export function computeZoneDeltas(input: ZoneDeltaInput): ZoneDelta[] {
  const prevContent = input.previousZones?.zoneContentHashes ?? {};
  const prevCrossings = input.previousZones?.crossings ?? [];
  const deltas: ZoneDelta[] = [];

  for (const { zone, previous } of input.pairs) {
    const currentContent = input.contentHashes[zone.id];
    const previousContent = prevContent[previous.id];
    // An unknown hash on either side is not evidence of sameness; judge it.
    const contentChanged = !currentContent || !previousContent || currentContent !== previousContent;

    const currentHeader = computeZoneHeaderHash(zone, input.projectDir);
    const previousHeader = previous.headerHash;
    const headersChanged = previousHeader !== undefined && currentHeader !== "" && currentHeader !== previousHeader;

    const prevFiles = new Set(previous.files);
    const currFiles = new Set(zone.files);
    const filesAdded = zone.files.filter((f) => !prevFiles.has(f));
    const filesRemoved = previous.files.filter((f) => !currFiles.has(f));

    if (!contentChanged && !headersChanged && filesAdded.length === 0 && filesRemoved.length === 0) continue;

    const before = crossingCounts(previous.id, prevCrossings);
    const after = crossingCounts(zone.id, input.currentCrossings);
    const crossingsDelta: Record<string, number> = {};
    for (const partner of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const d = (after[partner] ?? 0) - (before[partner] ?? 0);
      if (d !== 0) crossingsDelta[partner] = d;
    }

    deltas.push({
      zone,
      previous,
      filesAdded,
      filesRemoved,
      contentChanged,
      headersChanged,
      crossingsDelta,
      cohesionDelta: round2(zone.cohesion - previous.cohesion),
      couplingDelta: round2(zone.coupling - previous.coupling),
    });
  }
  return deltas;
}

// ── Request ──────────────────────────────────────────────────────────────────

/** Stable identity of a previous finding across runs: where it was, what it said. */
export function findingKey(finding: Finding): string {
  return `${finding.scope}\u0000${finding.text}`;
}

/**
 * A previous AI finding that was itself judged (it carries `confidence`), so
 * the still-holds Noul replaces the hash rule for it. Pass 0 findings are
 * recomputed every run and unjudged legacy findings keep the hash rule, so
 * neither reaches here.
 */
export function judgedPreviousFindings(findings: Finding[] | undefined): Finding[] {
  return (findings ?? []).filter((f) => f.pass > 0 && f.confidence !== undefined);
}

export interface RerunRequest {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
  /** Question id → the zone delta it asks about. */
  zoneIds: Map<string, ZoneDelta>;
  /** Question id → the finding it asks about. */
  findingIds: Map<string, Finding>;
}

/**
 * One request: a refresh Noul per changed zone and a still-holds Noul per
 * judged previous finding whose scope is one of those zones. Both read the
 * same `zones.<id>` subtree, which is also what keys them in the judgment
 * cache — so an unchanged zone's questions re-key identically and hit.
 */
export function buildRerunRequest(
  deltas: ZoneDelta[],
  findings: Finding[],
  projectDir?: string,
): RerunRequest {
  const zState: Record<string, JsonValue> = {};
  const questions: Record<string, JevQuestion> = {};
  const zoneIds = new Map<string, ZoneDelta>();
  const findingIds = new Map<string, Finding>();

  deltas.forEach((d, i) => {
    const { zone, previous } = d;
    zState[zone.id] = {
      fileCount: zone.files.length,
      files: zone.files.slice(0, ZONE_FILE_SAMPLE),
      headers: collectFileHeaders(zone.files.slice(0, ZONE_FILE_SAMPLE), projectDir),
      cohesion: zone.cohesion,
      coupling: zone.coupling,
      delta: {
        filesAdded: d.filesAdded,
        filesRemoved: d.filesRemoved,
        fileContentsChanged: d.contentChanged,
        leadingCommentsChanged: d.headersChanged,
        crossingsChanged: d.crossingsDelta,
        cohesionDelta: d.cohesionDelta,
        couplingDelta: d.couplingDelta,
      },
      previously: {
        insights: (previous.insights ?? []).slice(0, PREVIOUS_ITEMS_PER_ZONE),
      },
    };
    const qid = `rz${i}`;
    questions[qid] = noul(
      `The previous analysis described \`zones.${zone.id}\` with the insights in \`zones.${zone.id}.previously\`. ` +
        `What has changed since is in \`zones.${zone.id}.delta\`. ` +
        `Does that change alter what a maintainer would say about the zone's purpose, boundaries or risks?`,
    );
    zoneIds.set(qid, d);
  });

  const judgedScopes = new Set(deltas.map((d) => d.zone.id));
  const fState: Record<string, JsonValue> = {};
  findings.forEach((f, i) => {
    if (!judgedScopes.has(f.scope)) return;
    const id = `f${i}`;
    fState[id] = {
      text: f.text,
      type: f.type,
      scope: f.scope,
      anchors: (f.anchors ?? []).map((a) => a.file),
    };
    const qid = `fh${i}`;
    questions[qid] = noul(
      `Finding \`findings.${id}\` was recorded about \`zones.${f.scope}\` in a previous analysis. ` +
        `Judging by that zone's files, their leading comments and what changed since ` +
        `(\`zones.${f.scope}.delta\`), does it still hold? Answer no if the code it describes has been fixed or removed.`,
    );
    findingIds.set(qid, f);
  });

  const state: Record<string, JsonValue> = { zones: zState };
  if (Object.keys(fState).length > 0) state.findings = fState;
  return { state, questions, zoneIds, findingIds };
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

export type ZoneRefreshVerdict = "refresh" | "keep" | "uncertain";
export type FindingHoldVerdict = "carry" | "resolve" | "uncertain";

export interface RerunOutcome {
  /** Zone id → what to do with its previous narrative. Absent = not judged. */
  zones: Map<string, ZoneRefreshVerdict>;
  /** {@link findingKey} → verdict and the probability behind it. */
  findings: Map<string, { verdict: FindingHoldVerdict; probability: number }>;
  summary: RerunSummary;
  calls: number;
  tokenUsage?: { input: number; output: number };
}

export function emptyRerunOutcome(): RerunOutcome {
  return {
    zones: new Map(),
    findings: new Map(),
    summary: { zonesJudged: 0, refreshed: 0, findingsJudged: 0, carried: 0, resolved: 0, uncertain: 0 },
    calls: 0,
  };
}

function bandZone(p: number): ZoneRefreshVerdict {
  if (p >= RERUN_REFRESH_MIN_PROBABILITY) return "refresh";
  if (p <= RERUN_KEEP_MAX_PROBABILITY) return "keep";
  return "uncertain";
}

function bandFinding(p: number): FindingHoldVerdict {
  if (p >= FINDING_HOLDS_MIN_PROBABILITY) return "carry";
  if (p < FINDING_HOLDS_DROP_BELOW) return "resolve";
  return "uncertain";
}

/**
 * Ask both Nouls over the changed zones and the previous findings scoped to
 * them. Inert without a `zone.judge` route and when nothing changed.
 */
export async function judgeRerun(
  deltas: ZoneDelta[],
  previousFindings: Finding[],
  projectDir?: string,
): Promise<RerunOutcome> {
  const outcome = emptyRerunOutcome();
  if (deltas.length === 0 || getJudgmentRoute("zone.judge") !== "typesafe") return outcome;

  const usage = { input: 0, output: 0 };
  const uncertainZones: string[] = [];

  for (let start = 0; start < deltas.length; start += ZONES_PER_REQUEST) {
    const batch = deltas.slice(start, start + ZONES_PER_REQUEST);
    const batchScopes = new Set(batch.map((d) => d.zone.id));
    const request = buildRerunRequest(batch, previousFindings.filter((f) => batchScopes.has(f.scope)), projectDir);
    if (Object.keys(request.questions).length === 0) continue;

    let response;
    try {
      response = await askJev({ state: request.state, questions: request.questions }, { taskClass: "zone.judge" });
    } catch (err) {
      if (!(err instanceof ClaudeClientError)) throw err;
      // A failed re-run judgment leaves the hash rules in charge for the rest
      // of the run — the behaviour this module replaces, not a broken one.
      console.warn(`  [rerun] judgment failed (${err.reason}) — hash rules stand for ${deltas.length - start} zone(s): ${err.message.slice(0, 160)}`);
      break;
    }
    outcome.calls++;
    addCallTokens(usage, response.tokenUsage);

    for (const [qid, delta] of request.zoneIds) {
      const a = response.answers[qid];
      if (a?.type !== "noul") continue;
      const verdict = bandZone(a.noul);
      outcome.zones.set(delta.zone.id, verdict);
      outcome.summary.zonesJudged++;
      if (verdict === "refresh") outcome.summary.refreshed++;
      if (verdict === "uncertain") uncertainZones.push(delta.zone.id);
    }
    for (const [qid, finding] of request.findingIds) {
      const a = response.answers[qid];
      if (a?.type !== "noul") continue;
      const probability = round2(a.noul);
      const verdict = bandFinding(probability);
      outcome.findings.set(findingKey(finding), { verdict, probability });
      outcome.summary.findingsJudged++;
      if (verdict === "resolve") {
        outcome.summary.resolved++;
        logResolvedFinding(finding, probability);
      } else {
        outcome.summary.carried++;
        if (verdict === "uncertain") outcome.summary.uncertain++;
      }
    }
  }

  if (uncertainZones.length > 0) outcome.summary.uncertainZones = uncertainZones;
  if (outcome.calls > 0) {
    outcome.tokenUsage = usage;
    console.log(
      `  [rerun] ${outcome.summary.zonesJudged} changed zone(s) judged — ${outcome.summary.refreshed} to re-narrate, ` +
        `${uncertainZones.length} undecided; ${outcome.summary.findingsJudged} previous finding(s) — ` +
        `${outcome.summary.carried} carried (${outcome.summary.uncertain} with lowered confidence), ${outcome.summary.resolved} resolved ` +
        `(${usage.input} in / ${usage.output} out)`,
    );
  }
  return outcome;
}

/**
 * Apply the finding verdicts to one previous finding.
 *
 * Returns the finding to keep, or `null` to drop it. A finding with no verdict
 * is returned untouched — the caller is responsible for falling back to the
 * hash rule, which is the only thing that can decide it.
 */
export function applyFindingVerdict(
  finding: Finding,
  outcome: RerunOutcome,
): Finding | null {
  const v = outcome.findings.get(findingKey(finding));
  if (!v) return finding;
  if (v.verdict === "resolve") return null;
  if (v.verdict === "uncertain") {
    return { ...finding, confidence: Math.min(finding.confidence ?? 1, v.probability) };
  }
  return finding;
}

// ── Resolved-finding log ─────────────────────────────────────────────────────

let _logPath: string | undefined;

/**
 * Point the resolved-finding log at a `.sourcevision` directory. Until this is
 * called the log is inert and nothing is written, so library callers and tests
 * see no files — the same contract as `configureJudgmentCache`.
 */
export function configureRerunLog(opts: { svDir: string } | undefined): void {
  _logPath = opts ? join(opts.svDir, SV_CACHE_DIRNAME, "rerun-log.jsonl") : undefined;
}

/** `append_log`'s entry shape, written to sourcevision's own log (see the module header). */
function logResolvedFinding(finding: Finding, probability: number): void {
  if (!_logPath) return;
  const entry = {
    timestamp: new Date().toISOString(),
    event: "finding-resolved",
    detail: `[${finding.scope}] ${finding.text} (still-holds probability ${probability})`,
    scope: finding.scope,
    probability,
  };
  try {
    mkdirSync(join(_logPath, ".."), { recursive: true });
    appendFileSync(_logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Never fail an analysis for its log.
  }
}
