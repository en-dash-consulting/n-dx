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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveLayout } from "@n-dx/llm-client";
import { DATA_FILES } from "../../shared/index.js";
import { loadCommitFiles, loadPrdModel, loadTrailerCommits, PRD_CACHE_DIRNAME } from "../rex-gateway.js";
import type { V2Tree } from "../rex-gateway.js";
import type { Manifest, Zones } from "../domain-gateway.js";
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

export interface ResolvedSetting {
  key: string;
  value: unknown;
  /** Hench's source string: `task.run`, `hench.*`, `llm.*`, `default`, a flag. */
  source: string;
}

export interface ResolveRead {
  settings: ResolvedSetting[];
  /** Why a run would be refused, as hench states it. */
  refusals: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}

export interface RunStatusRead {
  id: string;
  status: string;
  startedAt: string;
}

export interface PacketSources {
  /** Where the zone and run reads look, project-relative, for section provenance. */
  sourcePaths: { zones: string; runs: string };
  prd(): Promise<PrdRead | null>;
  evidence(itemIds: string[]): Promise<EvidenceRead | null>;
  zones(files: string[]): Promise<ZoneRead | null>;
  /** `ndx work --task=<id> --resolve`, parsed. */
  resolve(taskId: string): Promise<ResolveRead | null>;
  /** `ndx work --task=<id> --dry-run` output: the brief hench would send. */
  preview(taskId: string): Promise<string | null>;
  runs(taskId: string): Promise<RunStatusRead[] | null>;
}

/** The two reads that spawn `ndx`; the Prepare route owns that spawn, so it is injected. */
export interface SpawnedReads {
  resolve(taskId: string): Promise<ResolveRead | null>;
  preview(taskId: string): Promise<string | null>;
}

/** Most commits read for one packet; evidence is a sample, and the packet caps it again. */
const MAX_EVIDENCE_COMMITS = 40;

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    // An unreadable artifact reads as absent: the packet says the data is missing.
    return null;
  }
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

    resolve: (taskId) => spawned.resolve(taskId),
    preview: (taskId) => spawned.preview(taskId),

    async runs(taskId) {
      const dir = join(layout.henchDir, "runs");
      if (!existsSync(dir)) return [];
      const out: RunStatusRead[] = [];
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json") || name.startsWith(".")) continue;
        const run = readJson<{ id?: unknown; taskId?: unknown; status?: unknown; startedAt?: unknown }>(join(dir, name));
        if (run?.taskId === taskId && typeof run.id === "string" && typeof run.startedAt === "string") {
          out.push({ id: run.id, status: typeof run.status === "string" ? run.status : "unknown", startedAt: run.startedAt });
        }
      }
      return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
  };
}
