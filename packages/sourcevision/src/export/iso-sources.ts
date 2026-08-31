/**
 * Input adapters for the isometric map.
 *
 * Two ways to learn about a codebase, one output shape:
 *   - `loadFromSourcevision` reads an existing `.sourcevision/` analysis
 *   - `loadFromScan` derives everything from the file tree in a single pass
 *
 * Everything downstream — layering, sizing, colouring, routing, rendering —
 * consumes `IsoModelInput` and cannot tell the difference. That is the point:
 * one implementation, two sources, no drift.
 *
 * Only `node:` builtins are imported at runtime, so this module bundles into
 * the standalone skill script.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { IsoFileInput, IsoKind, IsoModelInput, IsoZoneInput } from "./iso-model.js";
import { asKind } from "./iso-model.js";
import { scanProject } from "./iso-scan.js";
import type {
  CallGraph,
  Classifications,
  Components,
  Imports,
  Inventory,
  Manifest,
  Zones,
} from "../schema/v1.js";

/** Archetype → visual kind. Anything unmapped falls through to support. */
const ARCHETYPE_KIND: Record<string, IsoKind> = {
  entrypoint: "entry",
  "route-handler": "entry",
  page: "entry",
  "cli-command": "logic",
  service: "logic",
  middleware: "logic",
  store: "data",
  schema: "data",
  types: "data",
  model: "data",
  component: "ui",
  hook: "ui",
  view: "ui",
  gateway: "gateway",
  adapter: "gateway",
  client: "gateway",
  utility: "support",
  config: "support",
  "test-helper": "support",
};

export interface LoadOptions {
  /** Override the timestamp stamped into the page. */
  analyzedAt?: string;
  /** Base URL for source links; auto-detected from the git remote when unset. */
  linkBase?: string;
  /** Set false to skip git lookups entirely. */
  useGit?: boolean;
}

// ── Git ─────────────────────────────────────────────────────────────────────

interface GitInfo {
  sha?: string;
  branch?: string;
  /** Commit timestamp of HEAD, ISO 8601. */
  committedAt?: string;
  /** https://host/owner/repo, normalized from the origin remote. */
  webUrl?: string;
}

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Normalize a git remote to a browsable base URL.
 * Handles `git@host:owner/repo.git` and `https://host/owner/repo.git`.
 */
export function remoteToWebUrl(remote: string): string | undefined {
  const cleaned = remote.trim().replace(/\.git$/, "");
  const ssh = cleaned.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = cleaned.match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+\/.+)$/);
  if (https) return `https://${https[1]}`;
  return undefined;
}

export function readGitInfo(root: string): GitInfo {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return {};
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  return {
    sha: git(root, ["rev-parse", "HEAD"]),
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    committedAt: git(root, ["log", "-1", "--format=%cI"]),
    webUrl: remote ? remoteToWebUrl(remote) : undefined,
  };
}

/**
 * A browsable base for file links, e.g. `https://host/owner/repo/blob/<sha>`.
 * Pinned to the commit rather than a branch so links keep working.
 */
function deriveLinkBase(info: GitInfo): string | undefined {
  if (!info.webUrl || !info.sha) return undefined;
  return `${info.webUrl}/blob/${info.sha}`;
}

/**
 * Timestamp for the page.
 *
 * Defaults to the HEAD commit time rather than the wall clock so regenerating
 * the map from an unchanged checkout produces a byte-identical file. Falling
 * back to `now` keeps it sensible outside a repository, at the cost of
 * reproducibility there.
 */
function resolveTimestamp(options: LoadOptions, info: GitInfo, fallback?: string): string {
  return options.analyzedAt ?? fallback ?? info.committedAt ?? new Date().toISOString();
}

// ── Call graph ──────────────────────────────────────────────────────────────

/**
 * Collapse a function-level call graph into zone-to-zone weights.
 *
 * The call graph is the closest thing the analysis has to runtime behaviour:
 * an import says two files are linked at build time, a call says one actually
 * invokes the other. Edges that exist only here (no import resolves them) are
 * usually dependency injection, which is exactly the shape static imports miss.
 */
export function aggregateCallEdges(
  callGraph: CallGraph,
  zoneOfFile: Map<string, string>,
): Array<{ fromZone: string; toZone: string; weight: number }> {
  const counts = new Map<string, { fromZone: string; toZone: string; weight: number }>();
  for (const edge of callGraph.edges) {
    if (!edge.calleeFile) continue; // external or unresolved
    const from = zoneOfFile.get(edge.callerFile);
    const to = zoneOfFile.get(edge.calleeFile);
    if (!from || !to || from === to) continue;
    const key = `${from}\t${to}`;
    const existing = counts.get(key);
    if (existing) existing.weight += 1;
    else counts.set(key, { fromZone: from, toZone: to, weight: 1 });
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.weight - a.weight ||
      a.fromZone.localeCompare(b.fromZone) ||
      a.toZone.localeCompare(b.toZone),
  );
}

// ── Sourcevision ────────────────────────────────────────────────────────────

const REQUIRED_FILES = ["zones.json", "inventory.json", "imports.json"];

/** Whether a directory holds a usable analysis. */
export function hasSourcevision(root: string): boolean {
  const svDir = join(root, ".sourcevision");
  return existsSync(svDir) && REQUIRED_FILES.every((f) => existsSync(join(svDir, f)));
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function loadFromSourcevision(root: string, options: LoadOptions = {}): IsoModelInput | null {
  const svDir = join(root, ".sourcevision");
  if (!hasSourcevision(root)) return null;

  const zonesData = readJson<Zones>(join(svDir, "zones.json"));
  const inventory = readJson<Inventory>(join(svDir, "inventory.json"));
  const imports = readJson<Imports>(join(svDir, "imports.json"));
  if (!zonesData || !inventory || !imports) return null;

  const classifications = readJson<Classifications>(join(svDir, "classifications.json"));
  const components = readJson<Components>(join(svDir, "components.json"));
  const manifest = readJson<Manifest>(join(svDir, "manifest.json"));
  const callGraph = readJson<CallGraph>(join(svDir, "callgraph.json"));

  const archetypeOf = new Map<string, string>();
  for (const entry of classifications?.files ?? []) {
    if (entry.archetype) archetypeOf.set(entry.path, entry.archetype);
  }

  const routesOf = new Map<string, number>();
  for (const group of components?.serverRoutes ?? []) {
    for (const route of group.routes ?? []) {
      routesOf.set(route.file, (routesOf.get(route.file) ?? 0) + 1);
    }
  }

  const files = new Map<string, IsoFileInput>();
  for (const file of inventory.files) {
    const archetype = archetypeOf.get(file.path);
    files.set(file.path, {
      lineCount: file.lineCount ?? 0,
      // Role is the more honest signal for tests: test files usually classify
      // as utility or test-helper, which would sink them into "support".
      kind: file.role === "test" ? "tests" : asKind(archetype ? ARCHETYPE_KIND[archetype] : undefined),
      label: archetype ?? undefined,
      routes: routesOf.get(file.path),
    });
  }

  // Detection artifacts carry meaningless cohesion/coupling — drawing one as
  // architecture would be a lie, so they are excluded from the scene entirely.
  const zones: IsoZoneInput[] = (zonesData.zones ?? [])
    .filter((z) => (z.files?.length ?? 0) > 0 && z.detectionQuality !== "artifact")
    .map((z) => ({
      id: z.id,
      name: z.name,
      description: z.description ?? "",
      files: z.files,
      entryPoints: z.entryPoints ?? [],
      cohesion: z.cohesion ?? 0,
      coupling: z.coupling ?? 0,
      riskLevel: z.riskMetrics?.riskLevel,
      insights: z.insights ?? [],
    }));

  const zoneOfFile = new Map<string, string>();
  for (const zone of zones) for (const f of zone.files) zoneOfFile.set(f, zone.id);

  const info = options.useGit === false ? {} : readGitInfo(root);
  const extraGaps: string[] = [];
  if (!classifications) {
    extraGaps.push(
      "No classifications.json — block colours fall back to a single support kind. Run a full analyze to classify archetypes.",
    );
  }
  if (!components || (components.serverRoutes ?? []).length === 0) {
    extraGaps.push(
      "No server routes detected — inbound entry points are inferred from zone entry files rather than real HTTP surfaces.",
    );
  }

  return {
    zones,
    crossings: (zonesData.crossings ?? []).map((c) => ({ fromZone: c.fromZone, toZone: c.toZone })),
    files,
    external: (imports.external ?? []).map((e) => ({
      package: e.package,
      importedBy: e.importedBy ?? [],
    })),
    findings: (zonesData.findings ?? []).map((f) => ({
      scope: f.scope,
      text: f.text,
      severity: f.severity,
    })),
    callEdges: callGraph ? aggregateCallEdges(callGraph, zoneOfFile) : undefined,
    linkBase: options.linkBase ?? deriveLinkBase(info),
    meta: {
      project: basename(resolve(root)),
      analyzedAt: resolveTimestamp(options, info, manifest?.analyzedAt),
      gitBranch: manifest?.gitBranch ?? info.branch,
      gitSha: manifest?.gitSha ?? info.sha,
      origin: "sourcevision",
      totalFiles: inventory.summary?.totalFiles ?? inventory.files.length,
      totalLines: inventory.summary?.totalLines ?? 0,
      extraGaps,
    },
  };
}

// ── Scan ────────────────────────────────────────────────────────────────────

export function loadFromScan(root: string, options: LoadOptions = {}): IsoModelInput {
  const scan = scanProject(root);
  const info = options.useGit === false ? {} : readGitInfo(root);

  const files = new Map<string, IsoFileInput>();
  for (const [path, meta] of scan.fileMeta) {
    files.set(path, { lineCount: meta.lineCount, kind: asKind(meta.kind) });
  }

  const extraGaps = [
    "Zones were inferred from directory structure, not from community detection. They reflect how the code is filed, which is not always how it is organised.",
    "Imports were extracted with regular expressions. Dynamic requires and build-tool path mapping beyond tsconfig paths and workspace names may be missed.",
  ];

  return {
    zones: scan.zones.map((z) => ({
      id: z.id,
      name: z.name,
      description: z.description,
      files: z.files,
      entryPoints: z.entryPoints,
      cohesion: z.cohesion,
      coupling: z.coupling,
      insights: z.insights,
    })),
    crossings: scan.crossings,
    files,
    external: scan.external,
    findings: [],
    linkBase: options.linkBase ?? deriveLinkBase(info),
    meta: {
      project: basename(resolve(root)),
      analyzedAt: resolveTimestamp(options, info),
      gitBranch: info.branch,
      gitSha: info.sha,
      origin: "scan",
      totalFiles: scan.totalFiles,
      totalLines: scan.totalLines,
      extraGaps,
    },
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export type IsoSourceMode = "auto" | "sourcevision" | "scan";

/**
 * Load input for a project, honouring an explicit mode.
 * Returns null only when `sourcevision` was demanded and is not available.
 */
export function loadIsoInput(
  root: string,
  mode: IsoSourceMode = "auto",
  options: LoadOptions = {},
): IsoModelInput | null {
  if (mode === "scan") return loadFromScan(root, options);
  const fromAnalysis = loadFromSourcevision(root, options);
  if (fromAnalysis) return fromAnalysis;
  if (mode === "sourcevision") return null;
  return loadFromScan(root, options);
}
