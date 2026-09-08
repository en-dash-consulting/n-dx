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
import type {
  IsoFileInput,
  IsoKind,
  IsoModelInput,
  IsoSeamVerification,
  IsoZoneInput,
} from "./iso-model.js";
import { asKind } from "./iso-model.js";
import { scanProject } from "./iso-scan.js";
import { loadDeclaredArchitecture } from "./iso-declared.js";
import type { DeclaredInfra, DeclaredSeam } from "./iso-declared.js";
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

/**
 * Index the callee names invoked from each of `files`.
 *
 * Restricted to the files that matter, because a whole-project index is tens of
 * megabytes of strings in service of a handful of declarations.
 *
 * Unlike `aggregateCallEdges`, edges with no resolvable `calleeFile` are kept.
 * An injected callback arrives as a parameter, so where it points is exactly
 * what static resolution cannot follow — discarding those edges would throw
 * away the only evidence a seam ever has.
 */
export function indexCalleesByFile(
  callGraph: CallGraph,
  files: Set<string>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  if (files.size === 0) return index;
  for (const edge of callGraph.edges) {
    if (!files.has(edge.callerFile)) continue;
    const existing = index.get(edge.callerFile);
    if (existing) existing.add(edge.callee);
    else index.set(edge.callerFile, new Set([edge.callee]));
  }
  return index;
}

/**
 * Check declared callbacks against the calls made on the receiving side.
 *
 * Evidence is looked for across the whole receiving zone rather than only the
 * file the declaration names, because a receiving module routinely hands the
 * callbacks on to a neighbour — n-dx's own scheduler seam names
 * `register-scheduler.ts`, which passes all four callbacks to
 * `usage-cleanup-scheduler.ts`, where they are actually invoked. The map draws
 * zones, so corroborating at zone granularity is both looser and honest about
 * what is being claimed.
 *
 * A qualified callee counts: `options.broadcast()` is a call to the injected
 * `broadcast`. That admits the odd coincidence — an unrelated `x.broadcast()`
 * in the same zone — so the panel names the file and expression it matched
 * instead of asserting proof.
 */
export function verifySeamCallbacks(
  callbacks: string[],
  receivingFiles: string[],
  index: Map<string, Set<string>>,
): IsoSeamVerification {
  const files = [...receivingFiles].sort();
  const corroborated: IsoSeamVerification["corroborated"] = [];
  const missing: string[] = [];

  for (const callback of callbacks) {
    let hit: IsoSeamVerification["corroborated"][number] | undefined;
    for (const file of files) {
      const callees = [...(index.get(file) ?? [])].sort();
      const expression =
        callees.find((c) => c === callback) ?? callees.find((c) => c.endsWith(`.${callback}`));
      if (expression) {
        hit = { callback, file, expression };
        break;
      }
    }
    if (hit) corroborated.push(hit);
    else missing.push(callback);
  }

  return { status: corroborated.length > 0 ? "verified" : "unverified", corroborated, missing };
}

// ── Resolving declarations onto zones ───────────────────────────────────────

/**
 * Resolve a declaration's endpoint to a zone id.
 *
 * Declarations name either a zone id directly or a file path, because both are
 * natural to write by hand: "web-server" and "web/src/server/start.ts" should
 * both work. A path prefix resolves to the zone owning the first file under it.
 */
function toZoneId(ref: string, zoneIds: Set<string>, zoneOfFile: Map<string, string>): string | null {
  if (zoneIds.has(ref)) return ref;
  const exact = zoneOfFile.get(ref);
  if (exact) return exact;
  const prefix = ref.replace(/\/+$/, "") + "/";
  for (const [file, zone] of zoneOfFile) {
    if (file.startsWith(prefix)) return zone;
  }
  return null;
}

interface SeamResolution {
  seams: NonNullable<IsoModelInput["seams"]>;
  /** Declarations that resolved to a single zone — nothing to draw between. */
  internal: string[];
  /** Declarations naming something no zone owns. */
  unresolved: string[];
  /** Declarations whose named callbacks the call graph could not find. */
  stale: string[];
  /** Drawn seams that name callbacks but had no call graph to check against. */
  unchecked: number;
}

/** Files belonging to each zone, for looking up a zone's receiving side. */
function groupFilesByZone(zoneOfFile: Map<string, string>): Map<string, string[]> {
  const byZone = new Map<string, string[]>();
  for (const [file, zone] of zoneOfFile) {
    const existing = byZone.get(zone);
    if (existing) existing.push(file);
    else byZone.set(zone, [file]);
  }
  return byZone;
}

/**
 * Resolve declared seams onto zone pairs, and check them where possible.
 *
 * A declaration that cannot be drawn is reported rather than dropped: somebody
 * wrote it expecting to see it, and "both ends are in the same zone" or "that
 * file is in no zone" is useful feedback, where silence is not.
 *
 * When a call graph is available the drawn seams are also checked against it,
 * so a declaration left behind by a refactor is marked rather than presented
 * with the same confidence as a corroborated one.
 */
function resolveSeams(
  seams: DeclaredSeam[],
  zoneIds: Set<string>,
  zoneOfFile: Map<string, string>,
  callGraph?: CallGraph | null,
): SeamResolution {
  const resolved: NonNullable<IsoModelInput["seams"]> = [];
  const internal: string[] = [];
  const unresolved: string[] = [];
  const stale: string[] = [];

  for (const seam of seams) {
    const label = `${seam.from} → ${seam.to}`;
    const fromZone = toZoneId(seam.from, zoneIds, zoneOfFile);
    const toZone = toZoneId(seam.to, zoneIds, zoneOfFile);
    if (!fromZone || !toZone) {
      unresolved.push(label);
      continue;
    }
    if (fromZone === toZone) {
      internal.push(label);
      continue;
    }
    resolved.push({ fromZone, toZone, callbacks: seam.callbacks, note: seam.note });
  }

  // Verification is a second pass so the call graph is walked once for every
  // seam rather than once per seam.
  const checkable = resolved.filter((s) => (s.callbacks ?? []).length > 0);
  if (callGraph && checkable.length > 0) {
    const filesByZone = groupFilesByZone(zoneOfFile);
    const receiving = new Set<string>();
    for (const seam of checkable) {
      for (const file of filesByZone.get(seam.toZone) ?? []) receiving.add(file);
    }
    const index = indexCalleesByFile(callGraph, receiving);
    for (const seam of checkable) {
      seam.verification = verifySeamCallbacks(
        seam.callbacks ?? [],
        filesByZone.get(seam.toZone) ?? [],
        index,
      );
      if (seam.verification.missing.length > 0) {
        stale.push(`${seam.fromZone} → ${seam.toZone} (${seam.verification.missing.join(", ")})`);
      }
    }
  }

  return {
    seams: resolved,
    internal,
    unresolved,
    stale,
    unchecked: callGraph ? 0 : checkable.length,
  };
}

/** Turn undrawable and unsupported declarations into caveats the page states. */
function seamGaps(resolution: SeamResolution): string[] {
  const gaps: string[] = [];
  if (resolution.internal.length > 0) {
    gaps.push(
      `${resolution.internal.length} declared seam${resolution.internal.length === 1 ? " has" : "s have"} both ends inside one zone, so there is nothing to draw between blocks: ${resolution.internal.join(", ")}.`,
    );
  }
  if (resolution.unresolved.length > 0) {
    gaps.push(
      `${resolution.unresolved.length} declared seam${resolution.unresolved.length === 1 ? "" : "s"} could not be placed — the named file or zone is not in the map: ${resolution.unresolved.join(", ")}.`,
    );
  }
  if (resolution.stale.length > 0) {
    gaps.push(
      `The call graph shows no call to some declared callbacks, so those declarations may be stale — nothing on the receiving side invokes them: ${resolution.stale.join("; ")}.`,
    );
  }
  if (resolution.unchecked > 0) {
    gaps.push(
      `${resolution.unchecked} declared seam${resolution.unchecked === 1 ? "" : "s"} could not be checked against the code: there is no call graph in this view, so the injected callbacks are taken on trust. Run a full analyze for a map that verifies them.`,
    );
  }
  return gaps;
}

function resolveInfrastructure(
  infrastructure: DeclaredInfra[],
  zoneIds: Set<string>,
  zoneOfFile: Map<string, string>,
): IsoModelInput["infrastructure"] {
  return infrastructure.map((infra) => {
    const consumers = new Set<string>();
    for (const ref of infra.usedBy ?? []) {
      const zone = toZoneId(ref, zoneIds, zoneOfFile);
      if (zone) consumers.add(zone);
    }
    return {
      id: infra.id,
      name: infra.name,
      kind: infra.kind,
      note: infra.note,
      origin: infra.origin,
      consumers: [...consumers].sort(),
    };
  });
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

  const zoneIds = new Set(zones.map((z) => z.id));
  const declared = loadDeclaredArchitecture(root, [...files.keys()]);
  const seamResolution = resolveSeams(declared.seams, zoneIds, zoneOfFile, callGraph);
  extraGaps.push(...seamGaps(seamResolution));

  return {
    zones,
    crossings: (zonesData.crossings ?? []).map((c) => ({ fromZone: c.fromZone, toZone: c.toZone })),
    seams: seamResolution.seams,
    infrastructure: resolveInfrastructure(declared.infrastructure, zoneIds, zoneOfFile),
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

  const zoneOfFile = new Map<string, string>();
  for (const zone of scan.zones) for (const f of zone.files) zoneOfFile.set(f, zone.id);
  const zoneIds = new Set(scan.zones.map((z) => z.id));
  const declared = loadDeclaredArchitecture(root, [...files.keys()]);
  const seamResolution = resolveSeams(declared.seams, zoneIds, zoneOfFile);
  extraGaps.push(...seamGaps(seamResolution));

  return {
    seams: seamResolution.seams,
    infrastructure: resolveInfrastructure(declared.infrastructure, zoneIds, zoneOfFile),
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
 *
 * `ndx init` writes empty `.sourcevision/` data files before anything has been
 * analyzed, so the presence of those files is not evidence that an analysis
 * happened. Auto mode therefore falls back to a scan when the analysis parses
 * but contains no zones — otherwise a freshly-initialized project reports
 * "nothing to map" while sitting on a tree full of source.
 */
export function loadIsoInput(
  root: string,
  mode: IsoSourceMode = "auto",
  options: LoadOptions = {},
): IsoModelInput | null {
  if (mode === "scan") return loadFromScan(root, options);
  const fromAnalysis = loadFromSourcevision(root, options);
  if (mode === "sourcevision") return fromAnalysis;
  if (fromAnalysis && fromAnalysis.zones.length > 0) return fromAnalysis;
  return loadFromScan(root, options);
}
