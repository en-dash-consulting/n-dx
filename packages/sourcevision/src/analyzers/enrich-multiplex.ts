/**
 * Multiplexed narration: every escalated zone in one text-model call.
 *
 * The per-zone prompt (enrich-per-zone.ts) was written for 200k-token
 * contexts and pays the CLI spawn floor — measured at 3 s before the model
 * reads a token — once per zone, on the critical path. Current models take
 * a million tokens; the cascade escalates at most six zones. One prompt with
 * a block per zone costs one spawn, and the model sees the escalated zones
 * together, which is the cross-zone view the batch prompts used to ask for
 * in a trailing note.
 *
 * The output is judged like any other narration (enrich-judge.ts), so the
 * contract asks for text-only findings when the judgment route is active.
 *
 * @module sourcevision/analyzers/enrich-multiplex
 */

import type {
  Finding,
  ProjectProfile,
  TokenUsage,
  Zone,
  ZoneCrossing,
} from "../schema/index.js";
import type { PromptEnvelope } from "@n-dx/llm-client";
import { callClaude, ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { tryParseJSON, extractFindings, extractZoneInsights, formatFileLabel } from "./enrich-parsing.js";
import { getPassConfig } from "./enrich-config.js";
import { computeZoneStructureHash } from "./enrich-per-zone.js";
import { collectFileHeaders } from "./file-headers.js";
import {
  section,
  svPromptEnvelope,
  svPrompt,
  logSvPromptSections,
  JSON_OBJECT_ONLY,
  ONLY_NEW_INSIGHTS,
  findingsContract,
  stripJudgedFields,
  outputLines,
  findingTypesHint,
} from "./prompt-envelope.js";

/** Narration is analytical: the deep tier, as the per-zone pass 2 call was. */
const NARRATION_PASS = 2;

/** File sample per zone on the first attempt, and on the retry. */
const FILES_FULL = 25;
const FILES_RETRY = 10;
/** Leading-comment budget per zone. */
const HEADER_BUDGET_CHARS = 1800;
/** Crossing lines per zone. */
const MAX_CROSSINGS = 10;

export interface NarrateZonesOptions {
  /** Every zone, for the one-line context list and crossing labels. */
  allZones: Zone[];
  crossings: ZoneCrossing[];
  fileArchetypes?: Map<string, string | null>;
  hints?: string;
  projectProfile?: ProjectProfile;
}

export interface NarrateZonesResult {
  /** The narrated zones, with insights appended and structureHash set. */
  zones: Zone[];
  newZoneInsights: Map<string, string[]>;
  newFindings: Finding[];
  tokenUsage: { calls: number; input: number; output: number };
  /** False when the call failed or nothing parsable came back. */
  success: boolean;
}

/** One zone's block in the multiplexed prompt. */
function renderZoneBlock(
  zone: Zone,
  maxFiles: number,
  opts: NarrateZonesOptions,
): string {
  const sample = zone.files.length > maxFiles + 2
    ? [...zone.files.slice(0, maxFiles), `... and ${zone.files.length - maxFiles} more`]
    : zone.files;
  const filesStr = sample.map((f) => formatFileLabel(f, opts.fileArchetypes)).join(", ");

  const crossingSummary = new Map<string, number>();
  for (const c of opts.crossings) {
    if (c.fromZone !== zone.id && c.toZone !== zone.id) continue;
    const key = c.fromZone === zone.id ? `${zone.id} → ${c.toZone}` : `${c.fromZone} → ${zone.id}`;
    crossingSummary.set(key, (crossingSummary.get(key) ?? 0) + 1);
  }
  const crossingLines = [...crossingSummary.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CROSSINGS)
    .map(([pair, count]) => `    ${pair}: ${count} imports`)
    .join("\n");

  const headers = collectFileHeaders(zone.files.slice(0, maxFiles), opts.projectProfile?.projectDir, HEADER_BUDGET_CHARS);
  const headerLines = Object.entries(headers)
    .map(([path, h]) => `    - ${path}:\n${h.split("\n").map((l) => `        ${l}`).join("\n")}`)
    .join("\n");

  const known = zone.insights ?? [];
  return [
    `Zone "${zone.id}" — ${zone.name} (cohesion: ${zone.cohesion}, coupling: ${zone.coupling}, ${zone.files.length} files)`,
    `  Files: ${filesStr}`,
    `  Known insights: ${known.length > 0 ? known.map((i) => `"${i}"`).join("; ") : "(none)"}`,
    `  Boundary crossings:\n${crossingLines || "    (none)"}`,
    ...(headerLines ? [`  File headers (leading doc comments — authoritative about each file's purpose):\n${headerLines}`] : []),
  ].join("\n");
}

/** The multiplexed envelope. Exported so its section costs can be measured. */
export function buildMultiplexEnvelope(
  zones: Zone[],
  maxFiles: number,
  opts: NarrateZonesOptions,
  judged: boolean,
): PromptEnvelope {
  const passConfig = getPassConfig(NARRATION_PASS, 0);
  const ids = new Set(zones.map((z) => z.id));
  const otherSummaries = opts.allZones
    .filter((z) => !ids.has(z.id))
    .map((z) => `"${z.name}" (${z.files.length} files, cohesion: ${z.cohesion})`)
    .join("; ");

  const blocks = zones.map((z) => renderZoneBlock(z, maxFiles, opts)).join("\n\n");
  const example = stripJudgedFields(
    `{"zones":[{"id":"${zones[0]?.id ?? "zone-id"}","newInsights":["new insight"],"findings":[{"type":"${passConfig.expectedTypes[0]}","scope":"${zones[0]?.id ?? "zone-id"}","text":"finding text","severity":"info"}]}]}`,
    judged,
  );

  return svPromptEnvelope([
    section(
      "role",
      `These ${zones.length} code zones were flagged for a closer look after import-graph analysis. For each, add what a maintainer would need to know: what holds it together, where its boundaries leak, and what to change.`,
    ),
    section("rules", `${passConfig.focus}\nJudge each zone on its own files; use the others only for context.`),
    section("input", blocks),
    section("other-zones", otherSummaries ? `Other zones in this codebase: ${otherSummaries}` : ""),
    section("hints", opts.hints ? `Project context from the developer:\n${opts.hints}` : ""),
    section(
      "output",
      outputLines([
        ONLY_NEW_INSIGHTS,
        "",
        findingsContract(false, judged),
        "",
        JSON_OBJECT_ONLY,
        example,
        "",
        `Return one entry per zone, ${zones.length} in total, keyed by the zone ids above. ${findingTypesHint(passConfig.expectedTypes, judged)} Empty arrays are fine if nothing new to add.`.replace(/\s{2,}/g, " "),
      ]),
    ),
  ]);
}

/**
 * Narrate all `zones` in one call, retrying once with a smaller file sample
 * when the answer does not parse. Returns the zones untouched (and
 * `success: false`) when both attempts fail.
 */
export async function narrateZones(
  zones: Zone[],
  opts: NarrateZonesOptions,
): Promise<NarrateZonesResult> {
  const tokenUsage = { calls: 0, input: 0, output: 0 };
  const empty: NarrateZonesResult = { zones, newZoneInsights: new Map(), newFindings: [], tokenUsage, success: false };
  if (zones.length === 0) return { ...empty, success: true };

  const judged = getJudgmentRoute("finding.judge") === "typesafe";
  const passConfig = getPassConfig(NARRATION_PASS, 0);

  for (const [attempt, maxFiles] of [FILES_FULL, FILES_RETRY].entries()) {
    const envelope = buildMultiplexEnvelope(zones, maxFiles, opts, judged);
    logSvPromptSections(`narrateZones (${zones.length} zones, attempt ${attempt + 1})`, envelope);
    const prompt = svPrompt(envelope);
    console.log(`  [narrate] ${zones.length} zone(s) in one call (attempt ${attempt + 1}/2, ${maxFiles} files per zone)...`);

    let text: string;
    try {
      const result = await callClaude(prompt, undefined, { taskClass: "zone.enrich-deep" });
      tokenUsage.calls++;
      tokenUsage.input += result.tokenUsage?.input ?? 0;
      tokenUsage.output += result.tokenUsage?.output ?? 0;
      text = result.text;
    } catch (err) {
      if (!(err instanceof ClaudeClientError)) throw err;
      tokenUsage.calls++;
      console.warn(`  [narrate] attempt ${attempt + 1} failed (${err.reason}): ${err.message.slice(0, 200)}`);
      if (err.reason === "auth" || err.reason === "not-found" || !err.retryable) return empty;
      continue;
    }

    const parsed = tryParseJSON(text);
    const entries: unknown[] = Array.isArray(parsed?.zones) ? parsed.zones : [];
    if (entries.length === 0) {
      console.warn(`  [narrate] attempt ${attempt + 1}: no parsable zone entries — ${attempt === 0 ? "retrying with a smaller sample" : "giving up"}`);
      continue;
    }

    const byId = new Map<string, Record<string, unknown>>();
    for (const e of entries) {
      if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string") {
        byId.set((e as { id: string }).id, e as Record<string, unknown>);
      }
    }
    const newZoneInsights = new Map<string, string[]>();
    const newFindings: Finding[] = [];
    const out = zones.map((zone) => {
      const entry = byId.get(zone.id);
      const insights = entry ? extractZoneInsights(entry, "newInsights") : [];
      newZoneInsights.set(zone.id, insights);
      if (entry) {
        newFindings.push(...extractFindings(
          { zones: [{ ...entry, id: zone.id }], findings: [] },
          NARRATION_PASS,
          passConfig.expectedTypes,
          { skipSpeculativeFilter: judged },
        ));
      }
      const merged = [...(zone.insights ?? [])];
      for (const i of insights) if (!merged.includes(i)) merged.push(i);
      return { ...zone, insights: merged, structureHash: computeZoneStructureHash(zone) };
    });
    const missing = zones.filter((z) => !byId.has(z.id)).map((z) => z.id);
    if (missing.length > 0) console.warn(`  [narrate] no entry for ${missing.length} zone(s): ${missing.join(", ")}`);
    return { zones: out, newZoneInsights, newFindings, tokenUsage, success: true };
  }
  return empty;
}
