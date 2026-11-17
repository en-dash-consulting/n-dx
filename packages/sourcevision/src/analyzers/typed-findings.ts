/**
 * Findings computed from the graph, anchored by construction.
 *
 * The pass 0 heuristics this sits beside are metric paraphrase: they read a
 * cohesion number and say it again in a sentence. A reader cannot act on
 * "cohesion 0.31" because it names no file, and the judgment that grades it
 * cannot do better, because the evidence it is shown is the same number.
 *
 * Every finding here is derived from specific edges, and carries those edges
 * out with it — as `anchors` on the finding, and as the state the judgment
 * sees. So the question put to Jev is not "is 0.31 bad" but "these six files
 * import each other in a cycle; is that a real problem here?", which is a
 * question evidence can answer. A confirmed finding keeps its severity; one
 * judged an artifact of how zones were detected drops to `info` rather than
 * being deleted, because the edges are real even when the conclusion is not.
 *
 * Six kinds, each a definition over the import graph and nothing else:
 *
 * | kind | definition |
 * |---|---|
 * | `layering-violation` | a zone pair importing both ways; the thinner direction is the violation |
 * | `cycle-member` | a file in a circular import chain |
 * | `hub-file` | a file imported from three or more zones |
 * | `test-only-module` | a source file imported only by tests |
 * | `dead-export` | a file that exports declarations nothing imports |
 * | `boundary-crossing` | cross-zone imports that bypass the target zone's entry points |
 *
 * Deterministic in, deterministic out: with no judgment route the findings are
 * still produced and still anchored, they simply keep their default severity.
 *
 * @module sourcevision/analyzers/typed-findings
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Finding,
  FindingAnchor,
  Imports,
  TokenUsage,
  Zone,
  ZoneCrossing,
} from "../schema/index.js";
import { askJev, noul } from "@n-dx/llm-client";
import type { JevQuestion, JsonValue } from "@n-dx/llm-client";
import { ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { buildZoneEvidence } from "./enrich-judge.js";
import type { FindingEvidence } from "./enrich-judge.js";
import { extractTopLevelDeclarations, isTestPath } from "./zone-symbols.js";
import { addCallTokens } from "./token-usage.js";

export type TypedFindingKind =
  | "layering-violation"
  | "cycle-member"
  | "hub-file"
  | "test-only-module"
  | "dead-export"
  | "boundary-crossing";

/** One import edge, as the judgment is shown it. */
export interface TypedEdge {
  from: string;
  to: string;
}

/** A finding plus the derivation that produced it, kept for the judgment. */
export interface TypedFinding {
  kind: TypedFindingKind;
  finding: Finding;
  /** The edges this finding is made of. Also the source of `finding.anchors`. */
  edges: TypedEdge[];
}

/**
 * Findings emitted per kind. A repository with 400 cycle members does not
 * need 400 lines about it, and the judgment costs a question each.
 */
export const MAX_PER_KIND = 12;
/** Zones a file must be imported from before it counts as a hub. */
export const HUB_ZONE_THRESHOLD = 3;
/** Edges the thinner direction of a bidirectional pair may have and still be called the violation. */
export const LAYERING_MINORITY_MAX_SHARE = 0.4;
/** Cross-zone edges into non-entry-point files before a boundary finding is worth making. */
export const BOUNDARY_MIN_EDGES = 3;
/** Files read when checking for dead exports. Each is a parse. */
export const DEAD_EXPORT_FILE_BUDGET = 60;

function anchorsOf(edges: TypedEdge[], extra?: Map<string, FindingAnchor>): FindingAnchor[] {
  const seen = new Map<string, FindingAnchor>();
  for (const e of edges) {
    for (const file of [e.from, e.to]) {
      if (!seen.has(file)) seen.set(file, extra?.get(file) ?? { file });
    }
  }
  return [...seen.values()];
}

// ── Derivations ──────────────────────────────────────────────────────────────

export interface TypedFindingInput {
  zones: Zone[];
  crossings: ZoneCrossing[];
  imports: Imports;
  /** Needed for dead-export detection; without it that kind is skipped. */
  projectDir?: string;
  /** Pass number stamped on every finding. */
  pass: number;
}

/** Zone pairs that import both ways; the thinner direction is the finding. */
function layeringViolations(input: TypedFindingInput): TypedFinding[] {
  const byPair = new Map<string, ZoneCrossing[]>();
  for (const c of input.crossings) {
    if (c.fromZone === c.toZone) continue;
    const key = `${c.fromZone}\u0000${c.toZone}`;
    byPair.set(key, [...(byPair.get(key) ?? []), c]);
  }
  const names = new Map(input.zones.map((z) => [z.id, z.name]));
  const out: TypedFinding[] = [];
  const done = new Set<string>();
  for (const [key, forward] of byPair) {
    const [a, b] = key.split("\u0000");
    const reverseKey = `${b}\u0000${a}`;
    const reverse = byPair.get(reverseKey);
    if (!reverse || done.has(reverseKey)) continue;
    done.add(key);
    const [minor, minorFrom, minorTo, majorCount] =
      forward.length <= reverse.length ? [forward, a, b, reverse.length] : [reverse, b, a, forward.length];
    const share = minor.length / (minor.length + majorCount);
    if (share > LAYERING_MINORITY_MAX_SHARE) continue;
    const edges = minor.map((c) => ({ from: c.from, to: c.to }));
    out.push({
      kind: "layering-violation",
      edges,
      finding: {
        type: "anti-pattern",
        pass: input.pass,
        scope: minorFrom,
        text:
          `"${names.get(minorFrom) ?? minorFrom}" imports "${names.get(minorTo) ?? minorTo}" on ${minor.length} edge(s) ` +
          `while the ${majorCount} edge(s) between them run the other way — the minority direction looks like a layering violation`,
        severity: "warning",
        category: "structural",
        related: [minorTo],
        anchors: anchorsOf(edges),
      },
    });
  }
  return out.sort((x, y) => y.edges.length - x.edges.length).slice(0, MAX_PER_KIND);
}

/** Files in a circular import chain. One finding per cycle. */
function cycleMembers(input: TypedFindingInput): TypedFinding[] {
  const zoneOf = new Map<string, string>();
  for (const z of input.zones) for (const f of z.files) zoneOf.set(f, z.id);
  const out: TypedFinding[] = [];
  for (const { cycle } of input.imports.summary.circulars) {
    if (cycle.length < 2) continue;
    const edges: TypedEdge[] = cycle.map((f, i) => ({ from: f, to: cycle[(i + 1) % cycle.length] }));
    const scope = zoneOf.get(cycle[0]) ?? "global";
    out.push({
      kind: "cycle-member",
      edges,
      finding: {
        type: "anti-pattern",
        pass: input.pass,
        scope,
        text: `${cycle.length} files import each other in a cycle: ${cycle.join(" → ")} → ${cycle[0]}`,
        severity: "warning",
        category: "structural",
        anchors: anchorsOf(edges),
      },
    });
  }
  return out.sort((x, y) => y.edges.length - x.edges.length).slice(0, MAX_PER_KIND);
}

/** Files imported from three or more zones. */
function hubFiles(input: TypedFindingInput): TypedFinding[] {
  const importingZones = new Map<string, Set<string>>();
  const edgesByFile = new Map<string, TypedEdge[]>();
  for (const c of input.crossings) {
    const zones = importingZones.get(c.to) ?? new Set<string>();
    zones.add(c.fromZone);
    importingZones.set(c.to, zones);
    edgesByFile.set(c.to, [...(edgesByFile.get(c.to) ?? []), { from: c.from, to: c.to }]);
  }
  const zoneOf = new Map<string, string>();
  for (const z of input.zones) for (const f of z.files) zoneOf.set(f, z.id);
  const out: TypedFinding[] = [];
  for (const [file, zones] of importingZones) {
    if (zones.size < HUB_ZONE_THRESHOLD) continue;
    const edges = edgesByFile.get(file) ?? [];
    out.push({
      kind: "hub-file",
      edges,
      finding: {
        type: "anti-pattern",
        pass: input.pass,
        scope: zoneOf.get(file) ?? "global",
        text: `"${file}" is imported from ${zones.size} zones (${[...zones].sort().join(", ")}) — a cross-cutting dependency every one of them is coupled to`,
        severity: "warning",
        category: "structural",
        related: [...zones].sort(),
        anchors: anchorsOf(edges),
      },
    });
  }
  return out.sort((x, y) => y.edges.length - x.edges.length).slice(0, MAX_PER_KIND);
}

/** Source files whose every importer is a test. */
function testOnlyModules(input: TypedFindingInput): TypedFinding[] {
  const inbound = new Map<string, TypedEdge[]>();
  for (const e of input.imports.edges) {
    inbound.set(e.to, [...(inbound.get(e.to) ?? []), { from: e.from, to: e.to }]);
  }
  const zoneOf = new Map<string, string>();
  for (const z of input.zones) for (const f of z.files) zoneOf.set(f, z.id);
  const out: TypedFinding[] = [];
  for (const [file, edges] of inbound) {
    if (isTestPath(file) || edges.length === 0) continue;
    if (!edges.every((e) => isTestPath(e.from))) continue;
    out.push({
      kind: "test-only-module",
      edges,
      finding: {
        type: "anti-pattern",
        pass: input.pass,
        scope: zoneOf.get(file) ?? "global",
        text: `"${file}" is production code imported only by tests (${edges.length} importer(s), all test files) — either it is dead or its real caller is missing`,
        severity: "warning",
        category: "code",
        anchors: anchorsOf(edges),
      },
    });
  }
  return out.sort((x, y) => y.edges.length - x.edges.length).slice(0, MAX_PER_KIND);
}

/** Files that export declarations nothing imports. */
function deadExports(input: TypedFindingInput): TypedFinding[] {
  if (!input.projectDir) return [];
  const imported = new Set(input.imports.edges.map((e) => e.to));
  const entryPoints = new Set(input.zones.flatMap((z) => z.entryPoints));
  const out: TypedFinding[] = [];
  let budget = DEAD_EXPORT_FILE_BUDGET;
  for (const zone of input.zones) {
    for (const file of zone.files) {
      if (budget <= 0 || out.length >= MAX_PER_KIND) return out;
      if (imported.has(file) || entryPoints.has(file) || isTestPath(file)) continue;
      const abs = join(input.projectDir, file);
      if (!existsSync(abs)) continue;
      budget--;
      let text: string;
      try {
        text = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      const declarations = extractTopLevelDeclarations(text, file);
      if (declarations.length === 0) continue;
      const names = declarations.slice(0, 5).map((d) => d.name);
      out.push({
        kind: "dead-export",
        // No edges by definition — the absence is the evidence. The anchors
        // point at the declarations instead, which is what a reader deletes.
        edges: [],
        finding: {
          type: "anti-pattern",
          pass: input.pass,
          scope: zone.id,
          text: `"${file}" exports ${declarations.length} declaration(s) (${names.join(", ")}${declarations.length > names.length ? ", …" : ""}) that no file in the project imports`,
          severity: "warning",
          category: "code",
          anchors: declarations.slice(0, 5).map((d) => ({ file, lineRange: [d.line, d.line] as [number, number], symbol: d.name })),
        },
      });
    }
  }
  return out;
}

/** Cross-zone imports that reach past a zone's entry points into its interior. */
function boundaryCrossings(input: TypedFindingInput): TypedFinding[] {
  const entryPointsByZone = new Map(input.zones.map((z) => [z.id, new Set(z.entryPoints)]));
  const names = new Map(input.zones.map((z) => [z.id, z.name]));
  const byPair = new Map<string, TypedEdge[]>();
  for (const c of input.crossings) {
    if (c.fromZone === c.toZone) continue;
    const entries = entryPointsByZone.get(c.toZone);
    // A zone with no entry points has no interface to bypass; silence is right.
    if (!entries || entries.size === 0 || entries.has(c.to)) continue;
    const key = `${c.fromZone}\u0000${c.toZone}`;
    byPair.set(key, [...(byPair.get(key) ?? []), { from: c.from, to: c.to }]);
  }
  const out: TypedFinding[] = [];
  for (const [key, edges] of byPair) {
    if (edges.length < BOUNDARY_MIN_EDGES) continue;
    const [from, to] = key.split("\u0000");
    const targets = [...new Set(edges.map((e) => e.to))];
    out.push({
      kind: "boundary-crossing",
      edges,
      finding: {
        type: "anti-pattern",
        pass: input.pass,
        scope: from,
        text:
          `"${names.get(from) ?? from}" imports ${targets.length} interior file(s) of "${names.get(to) ?? to}" on ${edges.length} edge(s), ` +
          `none of them one of its entry points — the crossing has no interface module`,
        severity: "warning",
        category: "structural",
        related: [to],
        anchors: anchorsOf(edges),
      },
    });
  }
  return out.sort((x, y) => y.edges.length - x.edges.length).slice(0, MAX_PER_KIND);
}

/**
 * Every typed finding the graph supports, in a stable order. Makes no
 * request and reads no configuration; `judgeTypedFindings` grades them.
 */
export function computeTypedFindings(input: TypedFindingInput): TypedFinding[] {
  return [
    ...layeringViolations(input),
    ...cycleMembers(input),
    ...hubFiles(input),
    ...testOnlyModules(input),
    ...deadExports(input),
    ...boundaryCrossings(input),
  ];
}

// ── Judgment ─────────────────────────────────────────────────────────────────

/** At or below this the finding is a detection artifact and drops to `info`. */
export const TYPED_ARTIFACT_MAX_PROBABILITY = 0.3;
/** At or above this the finding stands as derived. */
export const TYPED_REAL_MIN_PROBABILITY = 0.7;
/** Findings per request; each carries its own edges plus the shared zone state. */
const TYPED_PER_REQUEST = 20;
/** Edges shown per finding. Enough to see the shape; the anchors carry the rest. */
const EDGES_SHOWN = 12;

export interface TypedFindingResult {
  findings: Finding[];
  tokenUsage?: TokenUsage;
  calls: number;
  /** Findings demoted to `info` as detection artifacts. */
  demoted: number;
  /** Findings whose probability landed between the two bands. */
  uncertain: number;
  /** Probability per finding text, for the agreement rate against the heuristic Noul. */
  probabilities: Map<string, number>;
}

/**
 * Ask Jev, per typed finding, whether it is a real problem — with the exact
 * edges that produced it in the state beside the zone evidence. Inert without
 * a `finding.judge` route: the findings come back as derived.
 */
export async function judgeTypedFindings(
  typed: TypedFinding[],
  evidence: FindingEvidence,
): Promise<TypedFindingResult> {
  const result: TypedFindingResult = {
    findings: typed.map((t) => t.finding),
    calls: 0,
    demoted: 0,
    uncertain: 0,
    probabilities: new Map(),
  };
  if (typed.length === 0 || getJudgmentRoute("finding.judge") !== "typesafe") return result;

  const usage: TokenUsage = { input: 0, output: 0 };
  const out = [...result.findings];

  for (let start = 0; start < typed.length; start += TYPED_PER_REQUEST) {
    const slice = typed.slice(start, start + TYPED_PER_REQUEST);
    const fState: Record<string, JsonValue> = {};
    const questions: Record<string, JevQuestion> = {};
    slice.forEach((t, i) => {
      fState[`f${i}`] = {
        kind: t.kind,
        text: t.finding.text,
        scope: t.finding.scope,
        edges: t.edges.slice(0, EDGES_SHOWN).map((e) => `${e.from} → ${e.to}`),
        anchors: (t.finding.anchors ?? []).map((a) => (a.symbol ? `${a.file}:${a.symbol}` : a.file)),
      };
      questions[`t${i}`] = noul(
        `\`findings.f${i}\` was derived from the import edges in \`findings.f${i}.edges\`. ` +
          `Given those edges and the zone they belong to, does it describe a real maintainability problem, ` +
          `rather than an expected arrangement for this kind of module or an artifact of how zones were detected?`,
      );
    });
    const state: JsonValue = {
      findings: fState,
      zones: buildZoneEvidence(slice.map((t) => t.finding.scope), evidence),
    };
    let response;
    try {
      response = await askJev({ state, questions }, { taskClass: "finding.judge" });
    } catch (err) {
      if (!(err instanceof ClaudeClientError)) throw err;
      console.warn(`  [judge] typed-finding judgment failed (${err.reason}) — keeping derived severities: ${err.message.slice(0, 160)}`);
      break;
    }
    result.calls++;
    addCallTokens(usage, response.tokenUsage);
    slice.forEach((t, i) => {
      const a = response.answers[`t${i}`];
      if (a?.type !== "noul") return;
      const p = Math.round(a.noul * 100) / 100;
      const index = start + i;
      result.probabilities.set(t.finding.text, p);
      if (p <= TYPED_ARTIFACT_MAX_PROBABILITY) {
        out[index] = { ...t.finding, severity: "info", confidence: p };
        result.demoted++;
      } else {
        out[index] = { ...t.finding, confidence: p };
        if (p < TYPED_REAL_MIN_PROBABILITY) result.uncertain++;
      }
    });
  }

  result.findings = out;
  result.tokenUsage = result.calls > 0 ? usage : undefined;
  if (result.calls > 0) {
    const outside = typed.length - result.uncertain;
    console.log(
      `  [judge] typed findings: ${typed.length} judged in ${result.calls} request(s) — ` +
        `${result.demoted} demoted to info, ${outside}/${typed.length} outside the uncertain band ` +
        `(${usage.input} in / ${usage.output} out)`,
    );
  }
  return result;
}

// ── Band calibration ─────────────────────────────────────────────────────────

/**
 * How often the heuristic Noul and the typed-finding Noul land on the same
 * side of the bands for the same zone. Recorded so the band can be set from
 * data rather than from the two constants above, which were carried over from
 * the heuristic judgment unchanged.
 */
export interface NoulAgreement {
  /** Zones where both judgments answered. */
  compared: number;
  /** Of those, how many agreed on artifact / uncertain / real. */
  agreed: number;
}

function band(p: number, artifactMax: number, realMin: number): "artifact" | "uncertain" | "real" {
  if (p <= artifactMax) return "artifact";
  return p < realMin ? "uncertain" : "real";
}

/**
 * Compare the two judgments per zone, taking each zone's highest probability
 * on either side. A zone judged by only one of them is not compared.
 */
export function noulAgreement(
  heuristic: Map<string, number>,
  typed: Map<string, number>,
): NoulAgreement {
  let compared = 0;
  let agreed = 0;
  for (const [zoneId, h] of heuristic) {
    const t = typed.get(zoneId);
    if (t === undefined) continue;
    compared++;
    if (band(h, TYPED_ARTIFACT_MAX_PROBABILITY, TYPED_REAL_MIN_PROBABILITY) ===
        band(t, TYPED_ARTIFACT_MAX_PROBABILITY, TYPED_REAL_MIN_PROBABILITY)) {
      agreed++;
    }
  }
  return { compared, agreed };
}

/** Highest probability per zone, from findings carrying a judged confidence. */
export function probabilitiesByZone(findings: Finding[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of findings) {
    if (f.confidence === undefined) continue;
    const current = out.get(f.scope);
    if (current === undefined || f.confidence > current) out.set(f.scope, f.confidence);
  }
  return out;
}
