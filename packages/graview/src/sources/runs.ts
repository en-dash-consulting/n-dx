/**
 * The work half: hench's run records, read off disk (`runs/<id>.json`, or
 * `.json.gz` once rotated) against the type hench publishes. A run points at
 * the task it worked and the commits it made; the commits are nodes too, each
 * landing for the run's task and saying how the record tied it to the run
 * (`attribution`), so a capability's realizing commits and a run's produced
 * commits meet on one id. `hench backfill-commits` fills the records the live
 * path could not.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { normalizeRunTokens, type RunRecord, type RunTokens } from "../hench-gateway.js";
import type { SnapshotEdge, SnapshotNode, SourceSlice, Warn } from "../types.js";
import { byString } from "../canonical.js";

export const RUNS_DIRNAME = "runs";

export interface RunsSlice extends SourceSlice {
  /** Commit subjects by sha, for commits other sources only know by hash. */
  commitSubjects: Map<string, string>;
  /** Task id → the shas of the commits its runs made: what landed for it, by the run records. */
  commitsFor: Map<string, string[]>;
}

function readRun(path: string, warn: Warn): RunRecord | undefined {
  try {
    const raw = readFileSync(path);
    const text = path.endsWith(".gz") ? gunzipSync(raw).toString("utf-8") : raw.toString("utf-8");
    const parsed = JSON.parse(text) as RunRecord;
    return typeof parsed.id === "string" && typeof parsed.taskId === "string" ? parsed : undefined;
  } catch (error) {
    warn(`Could not read run ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
}

export function readRuns(henchDir: string, warn: Warn): RunsSlice {
  const nodes: SnapshotNode[] = [];
  const edges: SnapshotEdge[] = [];
  const commitSubjects = new Map<string, string>();
  const commitsFor = new Map<string, string[]>();
  const attributionOf = new Map<string, string>();
  const runsDir = join(henchDir, RUNS_DIRNAME);
  if (!existsSync(runsDir)) return { nodes, edges, commitSubjects, commitsFor };

  // One record per id: a `.json` beside its `.json.gz` is the same run twice.
  const paths = new Map<string, string>();
  for (const entry of readdirSync(runsDir).sort(byString)) {
    if (entry.startsWith(".")) continue;
    const id = entry.endsWith(".json.gz") ? entry.slice(0, -".json.gz".length) : entry.endsWith(".json") ? entry.slice(0, -".json".length) : undefined;
    if (id === undefined) continue;
    if (!paths.has(id) || entry.endsWith(".json")) paths.set(id, join(runsDir, entry));
  }

  for (const [id, path] of [...paths.entries()].sort(([a], [b]) => byString(a, b))) {
    const run = readRun(path, warn);
    if (!run || run.id !== id) continue;
    const tokens: RunTokens = run.tokens ?? normalizeRunTokens(run.tokenUsage, run.turnTokenUsage);
    nodes.push({
      id: run.id,
      kind: "run",
      taskTitle: run.taskTitle || run.taskId,
      status: run.status,
      vendor: run.vendor,
      model: run.model,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      turns: integer(run.turns),
      tokens: integer(tokens.total),
      inputTokens: integer(tokens.input),
      outputTokens: integer(tokens.output),
      filesChanged: run.structuredSummary?.filesChanged ? run.structuredSummary.filesChanged.length : undefined,
      branch: run.branch,
    });
    edges.push({ kind: "ranFor", from: run.id, to: run.taskId });
    for (const commit of run.commits ?? []) {
      if (typeof commit.sha !== "string" || commit.sha.length === 0) continue;
      if (!commitSubjects.has(commit.sha)) commitSubjects.set(commit.sha, commit.subject ?? "");
      // A record written before the field existed came from the live path.
      if (!attributionOf.has(commit.sha)) attributionOf.set(commit.sha, commit.attribution ?? "start-head");
      edges.push({ kind: "produced", from: run.id, to: commit.sha });
      edges.push({ kind: "landedFor", from: commit.sha, to: run.taskId });
      const landed = commitsFor.get(run.taskId) ?? [];
      if (!landed.includes(commit.sha)) commitsFor.set(run.taskId, [...landed, commit.sha]);
    }
  }

  for (const [sha, subject] of [...commitSubjects.entries()].sort(([a], [b]) => byString(a, b))) {
    nodes.push({ id: sha, kind: "commit", sha, subject: subject || undefined, attribution: attributionOf.get(sha) });
  }

  return { nodes, edges, commitSubjects, commitsFor };
}
