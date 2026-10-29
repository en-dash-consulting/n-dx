/**
 * What the packet builders read.
 *
 * Builders are pure over a {@link PacketSources}: they take what is on disk
 * through these reads and render it, so a fixture tree and a stub are all a
 * snapshot test needs. {@link createPacketSources} is the production wiring;
 * every rex and sourcevision read in it goes through web's two gateways.
 *
 * A read returns `null` when its data is not there (no analysis, no git
 * history, no resolvable task). The builder then says so in the packet rather
 * than leaving the gap unmarked.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { redactDeep, resolveLayout } from "@n-dx/llm-client";
import { DATA_FILES } from "../../shared/index.js";
import { loadCommitFiles, loadPrdModel, loadTrailerCommits, PRD_CACHE_DIRNAME } from "../rex-gateway.js";
import type { V2Tree } from "../rex-gateway.js";
import type { Manifest, Zones } from "../domain-gateway.js";
import { readLiveReviewReport } from "../live-review-report.js";
import { readDiagnosis, type RunDiagnosisSummary } from "../run-diagnosis.js";
import { readLogTailLines, resolveRunEventsFile } from "../run-tail.js";
import type { ServerContext } from "../types.js";

export interface PrdRead {
  layout: "v1" | "v2";
  tree: V2Tree;
}

export interface EvidenceCommit {
  hash: string;
  subject: string;
  /** Author date, ISO 8601. */
  timestamp: string;
  /** The item ids its trailers name. */
  items: string[];
  files: string[];
}

export interface EvidenceRead {
  /** The commits whose `N-DX-Item` trailer names one of the requested ids, newest first. */
  commits: EvidenceCommit[];
}

export interface ZoneSummary {
  id: string;
  name: string;
  description: string;
  cohesion: number;
  coupling: number;
  fileCount: number;
  /** How many of the requested files this zone holds. */
  matched: number;
}

export interface ZoneRead {
  /** The analysis stamp (`manifest.analyzedAt`). */
  analyzedAt: string;
  /** Zones holding at least one requested file, most matches first. */
  zones: ZoneSummary[];
  /** Requested files no zone holds. */
  unzoned: number;
}

/** One zone in full, for the Explain lens: what the analysis says it is. */
export interface ZoneDetail {
  /** The analysis stamp (`manifest.analyzedAt`). */
  analyzedAt: string;
  id: string;
  name: string;
  description: string;
  cohesion: number;
  coupling: number;
  fileCount: number;
  /** A bounded sample, in analysis order. */
  files: string[];
  entryPoints: string[];
  insights: string[];
}

export interface ResolvedSetting {
  key: string;
  value: unknown;
  /** Hench's source string: `task.run`, `hench.*`, `llm.*`, `default`, a flag. */
  source: string;
}

export interface ResolveRead {
  settings: ResolvedSetting[];
  /** The tier saved on the task (`run.tier`), or `null` when none is saved. */
  savedTier?: string | null;
  /** Why a run would be refused, as hench states it. */
  refusals: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}

/**
 * `ndx work --resolve`'s JSON as a {@link ResolveRead}. Only entries that
 * carry a `source` are settings; anything else in `resolved` is skipped.
 */
export function readResolution(resolution: Record<string, unknown>): ResolveRead {
  const resolved = resolution.resolved && typeof resolution.resolved === "object" ? (resolution.resolved as Record<string, unknown>) : {};
  const settings: ResolvedSetting[] = Object.entries(resolved).flatMap(([key, entry]) => {
    const setting = entry as { value?: unknown; source?: unknown } | null;
    return setting && typeof setting.source === "string" ? [{ key, value: setting.value ?? null, source: setting.source }] : [];
  });
  const notes = (field: string): Array<{ code: string; message: string }> =>
    (Array.isArray(resolution[field]) ? (resolution[field] as Array<{ code?: unknown; message?: unknown }>) : []).map((n) => ({
      code: String(n.code),
      message: String(n.message),
    }));
  const saved = resolution.saved as { tier?: unknown } | null | undefined;
  return { settings, savedTier: typeof saved?.tier === "string" ? saved.tier : null, refusals: notes("refusals"), warnings: notes("warnings") };
}

export interface RunStatusRead {
  id: string;
  status: string;
  startedAt: string;
}

/** The run classifier's verdict as hench wrote it (`RunRecord.diagnosis`); actions in its rank order. */
export type RunVerdictRead = RunDiagnosisSummary;

/** The test gate's result on the run, with the text that says what failed. */
export interface RunGateRead {
  ran: boolean;
  passed: boolean;
  command: string | null;
  /** Why the gate gave no verdict, or was skipped. */
  note: string | null;
  /** Which recorded text {@link text} is; null when the run recorded none. */
  textKind: "failure digest" | "output tail" | null;
  /**
   * That text, capped at {@link GATE_TEXT_MAX_CHARS} at a line boundary. A
   * digest leads with its failing tests, so its start is kept; an output tail
   * ends with the verdict, so its end is kept.
   */
  text: string | null;
  /** Characters cut to fit, from the end of a digest or the front of an output tail. */
  cutChars: number;
}

/** One review finding the review left unrepaired. */
export interface RunFindingRead {
  title: string;
  location: string | null;
  verdict: string;
  action: string;
  severity: string | null;
}

export interface RunReviewRead {
  /** Project-relative path of the report. */
  path: string;
  summary: string | null;
  /** Must-fix findings not fixed, then any other finding whose action failed. */
  unrepaired: RunFindingRead[];
  /** Every finding in the report. */
  total: number;
}

export interface RunEventRead {
  at: string;
  kind: string;
  summary: string;
  detail: string | null;
}

/** The newest run of a task, read for the Diagnose run lens. */
export interface TaskRunRead {
  run: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    /** First line of the run's recorded error. */
    error: string | null;
    /** Project-relative path of the run record. */
    path: string;
  };
  /** Null when the run carries no verdict: it completed, is running, or predates the classifier. */
  diagnosis: RunVerdictRead | null;
  /** Null when the run recorded no gate. */
  gate: RunGateRead | null;
  /** Null when the run has no readable review report. */
  review: RunReviewRead | null;
  /** Null when the run has no event stream; otherwise its last {@link RUN_EVENTS_SHOWN} events. */
  events: { path: string; last: RunEventRead[] } | null;
}

export interface PacketSources {
  /** Where the zone and run reads look, project-relative, for section provenance. */
  sourcePaths: { zones: string; runs: string };
  prd(): Promise<PrdRead | null>;
  evidence(itemIds: string[]): Promise<EvidenceRead | null>;
  zones(files: string[]): Promise<ZoneRead | null>;
  /** The zone `ref` names (id, name, or an id it was known by), or `null` when there is none or no analysis. */
  zone(ref: string): Promise<ZoneDetail | null>;
  /** `ndx work --task=<id> --resolve`, parsed. */
  resolve(taskId: string, signal?: AbortSignal): Promise<ResolveRead | null>;
  /** `ndx work --task=<id> --dry-run` output: the brief hench would send. */
  preview(taskId: string, signal?: AbortSignal): Promise<string | null>;
  runs(taskId: string): Promise<RunStatusRead[] | null>;
  /** The task's newest run with its verdict, gate, review and last events; `null` when no run of it is recorded. */
  taskRun(taskId: string): Promise<TaskRunRead | null>;
}

/** Most characters of gate text a {@link TaskRunRead} carries, kept from the end. */
export const GATE_TEXT_MAX_CHARS = 2_400;

/** How many of the run's last events a {@link TaskRunRead} carries. */
export const RUN_EVENTS_SHOWN = 12;

/** The two reads that spawn `ndx`; the Prepare route owns that spawn, so it is injected. */
export interface SpawnedReads {
  /** Aborting `signal` kills the spawned `ndx`. */
  resolve(taskId: string, signal?: AbortSignal): Promise<ResolveRead | null>;
  preview(taskId: string, signal?: AbortSignal): Promise<string | null>;
}

/** Most commits read for one packet; evidence is a sample, and the packet caps it again. */
const MAX_EVIDENCE_COMMITS = 40;

/** Most files, entry points and insights one zone read carries; the packet is a summary, not an inventory. */
const ZONE_SAMPLE = 20;

/** Most run records parsed for one packet, newest file first; older runs are not read. */
const MAX_RUN_FILES = 200;

const RUN_FILE = /^[^.].*\.json(\.gz)?$/;

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path);
    return JSON.parse((path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf-8")) as T;
  } catch {
    // An unreadable artifact reads as absent: the packet says the data is missing.
    return null;
  }
}

/**
 * The run records of `taskId` under `dir`, newest start first, one per run id.
 *
 * Hench retention gzips older records to `<id>.json.gz`; skipping them would
 * report a task whose runs were all archived as never run. The archiver writes
 * `<id>.json.gz` before unlinking `<id>.json`, so a file can vanish between the
 * listing and its stat, and one run can briefly have both.
 */
function taskRunRecords(dir: string, taskId: string): Array<{ record: Record<string, unknown>; path: string }> {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((name) => RUN_FILE.test(name))
    .flatMap((name) => {
      const stat = statSync(join(dir, name), { throwIfNoEntry: false });
      return stat ? [{ path: join(dir, name), mtime: stat.mtimeMs }] : [];
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_RUN_FILES);
  const out: Array<{ record: Record<string, unknown>; path: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const record = readJson<Record<string, unknown>>(file.path);
    if (record?.taskId === taskId && typeof record.id === "string" && typeof record.startedAt === "string" && !seen.has(record.id)) {
      seen.add(record.id);
      out.push({ record, path: file.path });
    }
  }
  return out.sort((a, b) => String(b.record.startedAt).localeCompare(String(a.record.startedAt)));
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** The end of `text` within `max` characters, starting at a line where one starts inside it. */
function tailOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const from = text.length - max;
  const line = text.indexOf("\n", from);
  return line === -1 ? text.slice(from) : text.slice(line + 1);
}

/** The start of `text` within `max` characters, ending at a line break where one falls inside it. */
function headOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const line = text.lastIndexOf("\n", max);
  return line > 0 ? text.slice(0, line) : text.slice(0, max);
}

/**
 * The run's gate, with the text that says what failed: the failure digest
 * hench extracted from the whole output, else the output's tail. Text is kept
 * only for a gate that did not pass, to {@link GATE_TEXT_MAX_CHARS}: a
 * digest's start (its failing-test list comes first), a tail's end.
 */
function readGate(run: Record<string, unknown>): RunGateRead | null {
  const gate = run.testGate as Record<string, unknown> | undefined;
  if (!gate || typeof gate !== "object") return null;
  const ran = gate.ran === true;
  const passed = ran && gate.passed === true;
  const diagnostics = run.diagnostics as Record<string, unknown> | undefined;
  const digest = str(gate.failureDigest) ?? str(diagnostics?.testGateFailureDigest);
  const tail = str(gate.outputTail);
  const full = passed ? null : digest ?? tail;
  const text = full === null ? null : digest !== null ? headOf(full, GATE_TEXT_MAX_CHARS) : tailOf(full, GATE_TEXT_MAX_CHARS);
  return {
    ran,
    passed,
    command: str(gate.command),
    note: str(gate.error) ?? str(gate.skipReason),
    textKind: full === null ? null : digest !== null ? "failure digest" : "output tail",
    text,
    cutChars: full === null || text === null ? 0 : full.length - text.length,
  };
}

/** The unrepaired findings of the run's review report: hench's `classifyUnresolved`, read from the file. */
function readReview(henchDir: string, runId: string, display: (path: string) => string): RunReviewRead | null {
  const report = readLiveReviewReport(henchDir, runId);
  if (!report) return null;
  const mustFixOpen = (f: (typeof report.findings)[number]): boolean => f.verdict === "must-fix" && f.action !== "fixed";
  const unrepaired = [
    ...report.findings.filter(mustFixOpen),
    ...report.findings.filter((f) => !mustFixOpen(f) && f.action === "failed"),
  ];
  return {
    path: display(join(henchDir, "reviews", `${runId}.json`)),
    summary: report.summary,
    unrepaired: unrepaired.map((f) => ({
      title: f.title ?? "(untitled finding)",
      location: f.location,
      verdict: f.verdict ?? "unknown",
      action: f.action ?? "unknown",
      severity: f.severity,
    })),
    total: report.findings.length,
  };
}

/** The last {@link RUN_EVENTS_SHOWN} events of the run's stream; a line that is not an event is skipped. */
function readLastEvents(path: string): RunEventRead[] {
  return readLogTailLines(path, RUN_EVENTS_SHOWN * 2)
    .flatMap((line) => {
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        return typeof e.kind === "string" && typeof e.summary === "string"
          ? [{ at: typeof e.at === "string" ? e.at : "", kind: e.kind, summary: e.summary, detail: str(e.detail) }]
          : [];
      } catch {
        // The window's first line can be a fragment of a longer one.
        return [];
      }
    })
    .slice(-RUN_EVENTS_SHOWN);
}

/** The production reads for `ctx`'s workspace. */
export function createPacketSources(ctx: ServerContext, spawned: SpawnedReads): PacketSources {
  const layout = resolveLayout(ctx.projectDir);
  const display = (path: string) => relative(ctx.projectDir, path).split("\\").join("/");
  return {
    sourcePaths: {
      zones: display(join(layout.sourcevisionDir, DATA_FILES.zones)),
      runs: `${display(join(layout.henchDir, "runs"))}/`,
    },
    async prd() {
      try {
        const model = await loadPrdModel(ctx.rexDir);
        return { layout: model.layout, tree: model.tree };
      } catch {
        // No PRD, or one this build refuses: the packet reports it missing.
        return null;
      }
    },

    async evidence(itemIds) {
      const wanted = new Set(itemIds);
      if (wanted.size === 0) return { commits: [] };
      const cacheDir = join(ctx.rexDir, PRD_CACHE_DIRNAME);
      try {
        const all = await loadTrailerCommits({ repoDir: ctx.projectDir, cacheDir });
        const hits = all
          .filter((c) => c.items.some((id) => wanted.has(id)))
          // Author dates carry their author's UTC offset, so order by instant, not text.
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.hash.localeCompare(b.hash))
          .slice(0, MAX_EVIDENCE_COMMITS);
        const files = await loadCommitFiles(ctx.projectDir, cacheDir, hits.map((c) => c.hash));
        return {
          commits: hits.map((c) => ({
            hash: c.hash,
            subject: c.subject,
            timestamp: c.timestamp,
            items: c.items,
            files: files.get(c.hash) ?? [],
          })),
        };
      } catch {
        // No git history to read (not a repository, shallow clone): no evidence, said so in the packet.
        return null;
      }
    },

    async zones(files) {
      const manifest = readJson<Manifest>(join(ctx.svDir, DATA_FILES.manifest));
      const zones = readJson<Zones>(join(ctx.svDir, DATA_FILES.zones));
      if (!manifest || !zones || !Array.isArray(zones.zones)) return null;
      const wanted = new Set(files);
      const zoned = new Set<string>();
      const summaries: ZoneSummary[] = [];
      for (const zone of zones.zones) {
        const matched = zone.files.filter((f) => wanted.has(f));
        if (matched.length === 0) continue;
        for (const f of matched) zoned.add(f);
        summaries.push({
          id: zone.id,
          name: zone.name,
          description: zone.description,
          cohesion: zone.cohesion,
          coupling: zone.coupling,
          fileCount: zone.files.length,
          matched: matched.length,
        });
      }
      summaries.sort((a, b) => b.matched - a.matched || a.id.localeCompare(b.id));
      return { analyzedAt: manifest.analyzedAt, zones: summaries, unzoned: wanted.size - zoned.size };
    },

    async zone(ref) {
      const manifest = readJson<Manifest>(join(ctx.svDir, DATA_FILES.manifest));
      const zones = readJson<Zones>(join(ctx.svDir, DATA_FILES.zones));
      if (!manifest || !zones || !Array.isArray(zones.zones)) return null;
      const wanted = ref.trim().toLowerCase();
      const zone =
        zones.zones.find((z) => z.id === ref) ??
        zones.zones.find((z) => z.previousIds?.includes(ref)) ??
        zones.zones.find((z) => z.name.toLowerCase() === wanted);
      if (!zone) return null;
      return {
        analyzedAt: manifest.analyzedAt,
        id: zone.id,
        name: zone.name,
        description: zone.description,
        cohesion: zone.cohesion,
        coupling: zone.coupling,
        fileCount: zone.files.length,
        files: zone.files.slice(0, ZONE_SAMPLE),
        entryPoints: (zone.entryPoints ?? []).slice(0, ZONE_SAMPLE),
        insights: (zone.insights ?? []).slice(0, 5),
      };
    },

    resolve: (taskId, signal) => spawned.resolve(taskId, signal),
    preview: (taskId, signal) => spawned.preview(taskId, signal),

    async runs(taskId) {
      return taskRunRecords(join(layout.henchDir, "runs"), taskId).map(({ record }) => ({
        id: record.id as string,
        status: typeof record.status === "string" ? record.status : "unknown",
        startedAt: record.startedAt as string,
      }));
    },

    async taskRun(taskId) {
      const runsDir = join(layout.henchDir, "runs");
      const newest = taskRunRecords(runsDir, taskId)[0];
      if (!newest) return null;
      // A record written before hench scrubbed at save time may still hold a
      // secret a tool printed, and this text goes to the vendor.
      const run = redactDeep(newest.record);
      const id = run.id as string;
      const events = resolveRunEventsFile({ run, runsDir, worktreeRoot: ctx.projectDir }, [ctx.projectDir]);
      return {
        run: {
          id,
          status: str(run.status) ?? "unknown",
          startedAt: run.startedAt as string,
          finishedAt: str(run.finishedAt),
          error: str(run.error)?.split("\n")[0] ?? null,
          path: display(newest.path),
        },
        diagnosis: readDiagnosis(run.diagnosis) ?? null,
        gate: readGate(run),
        review: redactDeep(readReview(layout.henchDir, id, display)),
        events: events.kind === "file"
          ? {
              // The recorded path, not the resolved real one, which may sit under a symlinked temp root.
              path: display(typeof run.eventsPath === "string" ? run.eventsPath : join(runsDir, `${id}.events.jsonl`)),
              last: redactDeep(readLastEvents(events.path)),
            }
          : null,
      };
    },
  };
}
