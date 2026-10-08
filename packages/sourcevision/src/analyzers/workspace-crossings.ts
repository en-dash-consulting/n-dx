/**
 * Cross-repo crossing computation for workspace aggregation.
 *
 * When several repos are aggregated into a workspace, the edges between them
 * come from three different signals, and this module is the one place any of
 * them is turned into a `ZoneCrossing`:
 *
 *   - **npm** — an "external" import that actually names a sibling member's
 *     package. The strongest signal: the import graph states it outright.
 *   - **http** — an outbound call this member makes that resolves to a sibling
 *     member, either because the sibling declares the host as its `baseUrl` or
 *     because the sibling serves the route the call asks for.
 *   - **infra** — two members that reference the same piece of runtime
 *     infrastructure. Not a call at all; a shared resource, which is why its
 *     edge has no natural direction.
 *
 * Every cross-repo crossing carries its `source` and an `evidence` sentence
 * naming both sides. An edge no import supports is unreadable without one: the
 * question a reader asks of an http or infra edge is "says who?", and the
 * answer has to travel with the edge.
 *
 * ## The confidence threshold
 *
 * Only `certain` and `likely` edges are emitted. An `inferred` match is
 * withheld and reported as a `WithheldCrossing` with the reason, rather than
 * dropped — the common cause is a member that has not declared its `baseUrl`,
 * and a silent drop gives the operator nothing to act on. A wrong edge in a
 * cross-repo map is worse than a missing one: it is read as architecture.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  Confidence,
  CrossingSource,
  InfraLink,
  InfraResource,
  OutboundDependency,
  Zone,
  ZoneCrossing,
} from "../schema/index.js";
import type { SubAnalysis } from "./workspace.js";
import { toPosix } from "../util/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Package metadata extracted from a member's package.json. */
export interface MemberPackageInfo {
  /** npm package name (e.g., "@n-dx/llm-client", "rex"). */
  name: string;
  /** Resolved source entry file, relative to member root (e.g., "src/public.ts"). */
  entryFile?: string;
}

/** A resolved package map entry: member + optional entry file. */
export interface PackageMapEntry {
  member: SubAnalysis;
  entryFile?: string;
}

/**
 * A candidate edge that did not clear the confidence threshold.
 *
 * Reported rather than dropped so the operator can see *why* two repos that
 * obviously talk to each other are not joined — nearly always a missing
 * `baseUrl` declaration, which is a one-line fix they cannot make if the
 * near-miss is invisible.
 */
export interface WithheldCrossing {
  /** Which signal produced the candidate. */
  source: CrossingSource;
  /** Member prefix the edge would have come from. */
  fromMember: string;
  /** Member prefix the edge would have gone to, or "" when ambiguous. */
  toMember: string;
  /** What was matched, and why it was not enough. */
  reason: string;
  /** The confidence reached, always below the threshold. */
  confidence: Confidence;
}

/** Cross-repo edges, plus the near-misses that were not drawn. */
export interface CrossRepoEdges {
  crossings: ZoneCrossing[];
  withheld: WithheldCrossing[];
}

/** Ordering for `Confidence`, so a threshold can be a comparison. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  certain: 3,
  likely: 2,
  inferred: 1,
};

/**
 * The lowest confidence that is drawn.
 *
 * `likely` rather than `inferred`: every `inferred` rule here rests on two
 * names resembling each other and nothing else, and a name collision between
 * repositories is ordinary. An edge drawn on that alone would be read as a
 * dependency that does not exist.
 */
const CROSSING_THRESHOLD: Confidence = "likely";

function clears(confidence: Confidence): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[CROSSING_THRESHOLD];
}

// ── Entry file resolution ────────────────────────────────────────────────────

/** Common entry file conventions, checked in order. */
const ENTRY_FILE_CONVENTIONS = [
  "src/index.ts",
  "src/public.ts",
  "src/index.tsx",
  "src/main.ts",
  "index.ts",
  "index.js",
];

/**
 * Map a built output path to its likely source path.
 *
 * Common patterns:
 *   dist/public.js  → src/public.ts
 *   dist/index.mjs  → src/index.ts
 *   lib/main.cjs    → src/main.ts
 */
function distToSource(distPath: string): string {
  return distPath
    .replace(/^\.\//, "")
    .replace(/^(dist|lib|build|out)\//, "src/")
    .replace(/\.(js|mjs|cjs|jsx)$/, ".ts");
}

/**
 * Extract the entry point path from a package.json exports or main field.
 *
 * Handles:
 * - `exports["."]` as string: `"./dist/public.js"`
 * - `exports["."]` as condition map: `{ import: "./dist/public.js" }`
 * - `main`: `"dist/index.js"`
 * - `module`: `"dist/index.mjs"`
 */
function extractEntryPath(pkgJson: Record<string, unknown>): string | null {
  // Try exports["."] first (most modern)
  const exports = pkgJson.exports as Record<string, unknown> | undefined;
  if (exports) {
    const dotExport = exports["."];
    if (typeof dotExport === "string") {
      return dotExport;
    }
    if (dotExport && typeof dotExport === "object") {
      const conditions = dotExport as Record<string, unknown>;
      // Prefer: import > default > require
      const path = conditions.import ?? conditions.default ?? conditions.require;
      if (typeof path === "string") {
        return path;
      }
    }
  }

  // Try main
  if (typeof pkgJson.main === "string") {
    return pkgJson.main;
  }

  // Try module
  if (typeof pkgJson.module === "string") {
    return pkgJson.module;
  }

  return null;
}

/**
 * Resolve the source-level entry file for a package.
 *
 * Uses package.json fields to find the built entry point, maps it back to
 * a source file, and verifies it exists in the member's zone files. Falls
 * back to common conventions (src/index.ts, src/public.ts, etc.).
 *
 * @param pkgJson - Partial package.json contents (exports, main, module).
 * @param allMemberFiles - All files across the member's zones (relative to member root).
 * @returns The source entry file path (relative to member root), or null.
 */
export function resolveEntryFile(
  pkgJson: Record<string, unknown>,
  allMemberFiles: string[],
): string | null {
  const fileSet = new Set(allMemberFiles);

  // Try to resolve from package.json fields
  const entryPath = extractEntryPath(pkgJson);
  if (entryPath) {
    const sourcePath = distToSource(entryPath);
    if (fileSet.has(sourcePath)) {
      return sourcePath;
    }
  }

  // Fall back to conventions
  for (const convention of ENTRY_FILE_CONVENTIONS) {
    if (fileSet.has(convention)) {
      return convention;
    }
  }

  return null;
}

// ── Package map ──────────────────────────────────────────────────────────────

/**
 * Read package.json from a member's root directory and extract package info.
 *
 * The member root is derived from svDir (which is the absolute path to the
 * member's .sourcevision/ directory).
 */
export function readMemberPackageInfo(member: SubAnalysis): MemberPackageInfo | null {
  const memberRoot = dirname(member.svDir);
  const pkgJsonPath = join(memberRoot, "package.json");

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return null;
  }

  const name = pkgJson.name;
  if (typeof name !== "string" || !name) {
    return null;
  }

  // Collect all files across the member's zones for entry file resolution
  const allFiles = member.zones?.zones.flatMap((z) => z.files) ?? [];
  const entryFile = resolveEntryFile(pkgJson, allFiles) ?? undefined;

  return { name, entryFile };
}

/**
 * Build a map from npm package names to workspace members.
 *
 * @param members - The workspace members.
 * @param readInfo - Function to read package info from a member.
 *   Defaults to reading package.json from disk. Override for testing.
 */
export function buildPackageMap(
  members: SubAnalysis[],
  readInfo: (member: SubAnalysis) => MemberPackageInfo | null = readMemberPackageInfo,
): Map<string, PackageMapEntry> {
  const map = new Map<string, PackageMapEntry>();

  for (const member of members) {
    const info = readInfo(member);
    if (!info?.name) continue;

    map.set(info.name, {
      member,
      entryFile: info.entryFile,
    });
  }

  return map;
}

// ── Cross-repo crossing computation ──────────────────────────────────────────

/**
 * Find the target zone and file for a cross-repo import.
 *
 * When we know the entry file, we look it up in the promoted zones.
 * When we don't, we fall back to the first zone entry point of the target member.
 */
function resolveTarget(
  targetMember: SubAnalysis,
  entryFile: string | undefined,
  fileToZone: Map<string, string>,
  allZones: Zone[],
): { toFile: string; toZone: string } | null {
  // If we have a known entry file, look it up directly
  if (entryFile) {
    const prefixedFile = toPosix(join(targetMember.prefix, entryFile));
    const zone = fileToZone.get(prefixedFile);
    if (zone) {
      return { toFile: prefixedFile, toZone: zone };
    }
  }

  // Fallback: find the first promoted zone for this member that has entry points
  const memberZonePrefix = `${targetMember.id}:`;
  for (const zone of allZones) {
    if (!zone.id.startsWith(memberZonePrefix)) continue;
    if (zone.entryPoints.length > 0) {
      return { toFile: zone.entryPoints[0], toZone: zone.id };
    }
  }

  // Last resort: any zone for this member
  for (const zone of allZones) {
    if (!zone.id.startsWith(memberZonePrefix)) continue;
    if (zone.files.length > 0) {
      return { toFile: zone.files[0], toZone: zone.id };
    }
  }

  return null;
}

/**
 * Compute cross-repo zone crossings from workspace member external imports.
 *
 * Iterates over each member's external imports. When an external import's
 * package name matches a sibling member in the package map, it creates
 * zone crossings from the importing file's zone to the target member's
 * entry zone.
 *
 * @param members - All workspace members with their loaded data.
 * @param promotedZones - All promoted zones (with `{memberId}:{zoneId}` IDs).
 * @param packageMap - Map from npm package names to members (from buildPackageMap).
 * @returns Array of cross-repo zone crossings.
 */
export function computeCrossRepoCrossings(
  members: SubAnalysis[],
  promotedZones: Zone[],
  packageMap: Map<string, PackageMapEntry>,
): ZoneCrossing[] {
  const fileToZone = buildFileToZone(promotedZones);

  const crossings: ZoneCrossing[] = [];
  const seen = new Set<string>();

  for (const member of members) {
    if (!member.imports?.external) continue;

    for (const ext of member.imports.external) {
      const entry = packageMap.get(ext.package);
      if (!entry) continue;

      // Skip self-imports (member importing its own package)
      if (entry.member.id === member.id) continue;

      // Resolve target zone and file in the sibling member
      const target = resolveTarget(entry.member, entry.entryFile, fileToZone, promotedZones);
      if (!target) continue;

      for (const importingFile of ext.importedBy) {
        const fromFilePrefixed = toPosix(join(member.prefix, importingFile));
        const fromZone = fileToZone.get(fromFilePrefixed);
        if (!fromZone) continue;

        // Deduplicate: same from→to→fromZone→toZone
        const key = `${fromFilePrefixed}\0${target.toFile}\0${fromZone}\0${target.toZone}`;
        if (seen.has(key)) continue;
        seen.add(key);

        crossings.push({
          from: fromFilePrefixed,
          to: target.toFile,
          fromZone,
          toZone: target.toZone,
          source: "npm",
          evidence:
            `${member.prefix} imports "${ext.package}", the package ` +
            `${entry.member.prefix} publishes`,
        });
      }
    }
  }

  return crossings;
}

// ── Name normalization ───────────────────────────────────────────────────────

/**
 * Words that say what a thing *is* rather than which thing it is.
 *
 * Stripped from both sides of every name comparison, so `ORDERS_API_URL` and
 * the host `orders-api.internal` reduce to the same `["orders"]`. This is the
 * answer to "conventions differ between caller and callee": neither side is
 * taken as canonical — both are reduced to the words that carry identity.
 *
 * The cost is deliberate and bounded: two members whose names differ only by a
 * noise word (`orders-api`, `orders-service`) collapse together, which is
 * detected as an ambiguous match and withheld rather than guessed at.
 */
const NAME_NOISE_TOKENS: ReadonlySet<string> = new Set([
  "url", "uri", "urls", "endpoint", "endpoints", "host", "hostname",
  "addr", "address", "base", "baseurl", "origin", "target",
  "api", "apis", "service", "services", "svc", "server", "srv",
  "internal", "external", "public", "private", "prod", "production",
]);

/** Lowercase identity words of a name, noise removed. Order preserved. */
export function identityTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !NAME_NOISE_TOKENS.has(t));
}

/**
 * The names a member can be recognised by: its id, and the last segment of its
 * path. Both, because the id is already kebab-cased from the configured name
 * while the directory may carry the form other repos actually use.
 */
function memberNames(member: SubAnalysis): string[] {
  const leaf = member.prefix.split("/").filter(Boolean).pop();
  return leaf && leaf !== member.id ? [member.id, leaf] : [member.id];
}

/** True when two names carry the same identity words in the same order. */
function sameIdentity(a: string, b: string): boolean {
  const left = identityTokens(a);
  if (left.length === 0) return false;
  const right = identityTokens(b);
  return left.length === right.length && left.every((t, i) => t === right[i]);
}

// ── URL parsing ──────────────────────────────────────────────────────────────

/** Strip a `scheme://` prefix, if present. */
function stripScheme(target: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(target);
  return scheme ? target.slice(scheme[0].length) : target;
}

/**
 * The host of an outbound target, lowercased, without scheme, credentials,
 * path or port. `null` when the target names no host — a bare path, or an
 * empty target.
 *
 * Hand-rolled rather than `new URL()`: outbound targets are frequently
 * scheme-less (`orders-api:8080`, a gRPC dial address), which `URL` either
 * rejects or reads as a protocol.
 */
export function hostOf(target: string): string | null {
  let s = target.trim();
  if (!s || s.startsWith("/")) return null;
  s = stripScheme(s);
  if (!s || s.startsWith("/")) return null;

  // Credentials, but only when the `@` precedes the path.
  const pathStart = s.search(/[/?#]/);
  const at = s.lastIndexOf("@", pathStart === -1 ? s.length : pathStart);
  if (at !== -1) s = s.slice(at + 1);

  s = s.split(/[/?#]/)[0];

  const colon = s.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) s = s.slice(0, colon);

  return s.toLowerCase() || null;
}

/** The path of an outbound target, or `""` when it names none (or only `/`). */
export function pathOf(target: string): string {
  const s = stripScheme(target.trim());
  const cut = s.search(/[/?#]/);
  if (cut === -1) return "";
  const path = s.slice(cut).split(/[?#]/)[0];
  return path === "/" ? "" : path;
}

/** The first DNS label of a host — the part that names the service. */
function firstLabel(host: string): string {
  return host.split(".")[0];
}

// ── Server route matching ────────────────────────────────────────────────────

/**
 * Match one request path against one route pattern.
 *
 * Both `:param` and `{param}` segments, and a trailing `*`, stand for one or
 * more path segments. A prefix match counts: a caller asking for
 * `/api/orders/42/items` is reaching a repo that serves `/api/orders/:id`,
 * even though the route is not the whole path.
 */
function routeMatchesPath(routePath: string, requestPath: string): boolean {
  const routeSegs = routePath.split("/").filter(Boolean);
  const reqSegs = requestPath.split("/").filter(Boolean);
  if (routeSegs.length === 0 || routeSegs.length > reqSegs.length) return false;

  for (let i = 0; i < routeSegs.length; i++) {
    const seg = routeSegs[i];
    if (seg === "*" || seg.startsWith(":") || /^\{.*\}$/.test(seg)) continue;
    if (seg.toLowerCase() !== reqSegs[i].toLowerCase()) return false;
  }
  return true;
}

/**
 * The file of the first route this member serves that the path reaches, or
 * `null`.
 *
 * The longest matching route wins, so a member serving both `/api` and
 * `/api/orders/:id` attributes the call to the file that handles it rather
 * than to whichever group happened to be listed first.
 */
export function findServedRoute(
  member: SubAnalysis,
  requestPath: string,
): { file: string; path: string } | null {
  if (!requestPath) return null;

  let best: { file: string; path: string } | null = null;
  for (const group of member.components?.serverRoutes ?? []) {
    for (const route of group.routes) {
      if (!routeMatchesPath(route.path, requestPath)) continue;
      if (!best || route.path.length > best.path.length) {
        best = { file: route.file, path: route.path };
      }
    }
  }
  return best;
}

// ── HTTP crossings ───────────────────────────────────────────────────────────

/** Outbound kinds that can reach another repository over the network. */
const NETWORK_KINDS: ReadonlySet<OutboundDependency["kind"]> = new Set(["http", "grpc"]);

/** One member resolved as the far end of an outbound call. */
interface HttpMatch {
  member: SubAnalysis;
  confidence: Confidence;
  /** Why, naming what was matched on this side. */
  why: string;
  /** The member file serving the matched route, when a route matched. */
  routeFile?: string;
}

/**
 * Resolve an outbound call with a literal target to a sibling member.
 *
 * Two independent signals, and the ladder reflects how many held:
 *   - the host is a member's declared `baseUrl` host — a person said so;
 *   - the path is a route that member serves — its own analysis said so.
 *
 * Both, or a declared host with no path to check, is `certain`. Either alone
 * is `likely`. Neither — only the host *resembling* the member's name — is
 * `inferred`, and is withheld.
 */
function matchLiteralTarget(
  caller: SubAnalysis,
  target: string,
  candidates: SubAnalysis[],
): HttpMatch | null {
  const host = hostOf(target);
  if (!host) return null;
  const path = pathOf(target);

  let best: HttpMatch | null = null;

  for (const member of candidates) {
    if (member.id === caller.id) continue;

    const declaredHost = member.baseUrl ? hostOf(member.baseUrl) : null;
    const hostDeclared = declaredHost !== null && declaredHost === host;
    const nameResembles = memberNames(member).some((n) => sameIdentity(firstLabel(host), n));

    if (!hostDeclared && !nameResembles) continue;

    const served = findServedRoute(member, path);

    let confidence: Confidence;
    let why: string;
    if (hostDeclared && (served || !path)) {
      confidence = "certain";
      why = served
        ? `host "${host}" is ${member.prefix}'s declared base URL and it serves ${served.path}`
        : `host "${host}" is ${member.prefix}'s declared base URL`;
    } else if (hostDeclared) {
      confidence = "likely";
      why = `host "${host}" is ${member.prefix}'s declared base URL, which serves no route matching ${path}`;
    } else if (served) {
      confidence = "likely";
      why = `host "${host}" names ${member.prefix}, which serves ${served.path}`;
    } else {
      confidence = "inferred";
      why = `host "${host}" resembles ${member.prefix}'s name and nothing else corroborates it`;
    }

    const candidate: HttpMatch = {
      member,
      confidence,
      why,
      ...(served ? { routeFile: served.file } : {}),
    };
    if (!best || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[best.confidence]) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Resolve an outbound call whose target is an environment variable *name*.
 *
 * This is the hard half, because the caller names the variable and the callee
 * names the host, and neither knows what the other chose. Reducing both to
 * their identity words (see `NAME_NOISE_TOKENS`) is what makes
 * `ORDERS_API_URL` and `orders-api.internal` the same thing without either
 * side having to adopt the other's convention.
 *
 * Capped at `likely` by construction: an environment variable name is a
 * convention, never a statement of where it points, so no env match is ever
 * `certain`. A match against a member's declared `baseUrl` clears the
 * threshold; a match against a member's *name* alone does not, and is withheld
 * naming the missing declaration — which is the actionable part. An ambiguous
 * match is withheld rather than resolved arbitrarily.
 */
function matchEnvTarget(
  caller: SubAnalysis,
  envName: string,
  candidates: SubAnalysis[],
): { match: HttpMatch } | { ambiguous: string[] } | { undeclared: SubAnalysis } | null {
  const declared: SubAnalysis[] = [];
  const byName: SubAnalysis[] = [];

  for (const member of candidates) {
    if (member.id === caller.id) continue;

    const declaredHost = member.baseUrl ? hostOf(member.baseUrl) : null;
    if (declaredHost && sameIdentity(envName, firstLabel(declaredHost))) {
      declared.push(member);
      continue;
    }
    if (memberNames(member).some((n) => sameIdentity(envName, n))) {
      byName.push(member);
    }
  }

  const ambiguousAcross = [...declared, ...byName];
  if (declared.length > 1 || (declared.length === 0 && byName.length > 1)) {
    return { ambiguous: ambiguousAcross.map((m) => m.prefix) };
  }

  if (declared.length === 1) {
    const member = declared[0];
    return {
      match: {
        member,
        confidence: "likely",
        why: `"${envName}" names ${member.prefix}'s declared base URL "${member.baseUrl}"`,
      },
    };
  }

  if (byName.length === 1) return { undeclared: byName[0] };

  return null;
}

/**
 * Cross-repo crossings derived from outbound http and grpc calls.
 *
 * Each member's `outbound.json` is read for calls that could leave the
 * repository; each is resolved against the other members' declared base URLs
 * and served routes. Database, cache and queue kinds are not considered here —
 * they do reach other systems, but a shared queue is an `infra` edge, not a
 * call to a sibling repo, and is computed below.
 */
export function computeHttpCrossings(
  members: SubAnalysis[],
  promotedZones: Zone[],
): CrossRepoEdges {
  const fileToZone = buildFileToZone(promotedZones);
  const crossings: ZoneCrossing[] = [];
  const withheld: WithheldCrossing[] = [];
  const seen = new Set<string>();
  const withheldSeen = new Set<string>();

  const addWithheld = (entry: WithheldCrossing): void => {
    const key = `${entry.fromMember}\0${entry.toMember}\0${entry.reason}`;
    if (withheldSeen.has(key)) return;
    withheldSeen.add(key);
    withheld.push(entry);
  };

  for (const caller of members) {
    for (const dep of caller.outbound?.dependencies ?? []) {
      if (!NETWORK_KINDS.has(dep.kind)) continue;

      const fromFile = toPosix(join(caller.prefix, dep.file));
      const fromZone = fileToZone.get(fromFile);
      if (!fromZone) continue;

      let match: HttpMatch | null = null;

      if (dep.targetSource === "literal") {
        match = matchLiteralTarget(caller, dep.target, members);
        if (match && !clears(match.confidence)) {
          addWithheld({
            source: "http",
            fromMember: caller.prefix,
            toMember: match.member.prefix,
            reason: `${dep.target} — ${match.why}`,
            confidence: match.confidence,
          });
          continue;
        }
      } else if (dep.targetSource === "env") {
        const resolved = matchEnvTarget(caller, dep.target, members);
        if (!resolved) continue;
        if ("ambiguous" in resolved) {
          addWithheld({
            source: "http",
            fromMember: caller.prefix,
            toMember: "",
            reason:
              `env "${dep.target}" names more than one member ` +
              `(${resolved.ambiguous.join(", ")}); declare distinct baseUrl values to resolve it`,
            confidence: "inferred",
          });
          continue;
        }
        if ("undeclared" in resolved) {
          addWithheld({
            source: "http",
            fromMember: caller.prefix,
            toMember: resolved.undeclared.prefix,
            reason:
              `env "${dep.target}" resembles ${resolved.undeclared.prefix}'s name, but that member ` +
              `declares no baseUrl — add one to workspace.members to draw this edge`,
            confidence: "inferred",
          });
          continue;
        }
        match = resolved.match;
      }

      if (!match) continue;

      const target = match.routeFile
        ? resolveRouteTarget(match.member, match.routeFile, fileToZone, promotedZones)
        : resolveTarget(match.member, undefined, fileToZone, promotedZones);
      if (!target) continue;

      const key = `${fromFile}\0${target.toFile}\0${fromZone}\0${target.toZone}`;
      if (seen.has(key)) continue;
      seen.add(key);

      crossings.push({
        from: fromFile,
        to: target.toFile,
        fromZone,
        toZone: target.toZone,
        source: "http",
        evidence: `${caller.prefix} calls ${match.member.prefix} over ${dep.kind}: ${match.why}`,
      });
    }
  }

  return { crossings, withheld };
}

/** The member file serving a matched route, falling back to the member's entry. */
function resolveRouteTarget(
  member: SubAnalysis,
  routeFile: string,
  fileToZone: Map<string, string>,
  allZones: Zone[],
): { toFile: string; toZone: string } | null {
  const prefixed = toPosix(join(member.prefix, routeFile));
  const zone = fileToZone.get(prefixed);
  if (zone) return { toFile: prefixed, toZone: zone };
  return resolveTarget(member, undefined, fileToZone, allZones);
}

// ── Infrastructure crossings ─────────────────────────────────────────────────

/**
 * Resource kinds whose *name* is a shared identity rather than an
 * implementation detail.
 *
 * Two repositories naming the same queue are talking to each other through it.
 * Two repositories both having a resource called `main` of kind `database` are
 * not — which is why the name rule is restricted to these kinds and the
 * general rule requires the same resource id.
 */
const SHARED_BY_NAME_KINDS: ReadonlySet<string> = new Set([
  "queue",
  "topic",
  "bucket",
  "stream",
]);

/** The literals that identify a resource, falling back to its name. */
function resourceLiterals(resource: InfraResource): string[] {
  const literals = resource.literals?.length ? resource.literals : [resource.name];
  return literals.filter((l) => l.length > 2);
}

/**
 * Resolve a member's infrastructure link to a file and zone in the promoted
 * graph. `InfraLink.target` may be either a zone id or a project-relative
 * path, so both are tried.
 */
function resolveInfraEndpoint(
  member: SubAnalysis,
  link: InfraLink,
  fileToZone: Map<string, string>,
  zonesById: Map<string, Zone>,
): { file: string; zone: string } | null {
  const prefixedFile = toPosix(join(member.prefix, link.target));
  const zoneOfFile = fileToZone.get(prefixedFile);
  if (zoneOfFile) return { file: prefixedFile, zone: zoneOfFile };

  const zone = zonesById.get(`${member.id}:${link.target}`);
  if (zone) {
    const file = zone.entryPoints[0] ?? zone.files[0];
    if (file) return { file, zone: zone.id };
  }

  return null;
}

/**
 * Cross-repo crossings derived from two members referencing one piece of
 * infrastructure.
 *
 * A shared resource has no direction — neither member calls the other — so a
 * single edge is emitted per member pair per resource, oriented by member id
 * so repeated runs produce the same graph. The evidence names the resource and
 * both members' `infrastructure.json`.
 */
export function computeInfraCrossings(
  members: SubAnalysis[],
  promotedZones: Zone[],
): CrossRepoEdges {
  const fileToZone = buildFileToZone(promotedZones);
  const zonesById = new Map(promotedZones.map((z) => [z.id, z]));

  const crossings: ZoneCrossing[] = [];
  const withheld: WithheldCrossing[] = [];
  const seen = new Set<string>();

  const ordered = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];

      for (const resourceA of a.infrastructure?.resources ?? []) {
        for (const resourceB of b.infrastructure?.resources ?? []) {
          const sameId = resourceA.id === resourceB.id;
          const sharedName =
            !sameId &&
            SHARED_BY_NAME_KINDS.has(resourceA.kind) &&
            resourceA.kind === resourceB.kind &&
            resourceLiterals(resourceA).some((l) => resourceLiterals(resourceB).includes(l));

          if (!sameId && !sharedName) continue;

          const confidence: Confidence = sameId ? "certain" : "likely";
          const what = sameId
            ? `resource ${resourceA.id}`
            : `${resourceA.kind} "${resourceA.name}"`;

          const linkA = (a.infrastructure?.links ?? []).find((l) => l.resourceId === resourceA.id);
          const linkB = (b.infrastructure?.links ?? []).find((l) => l.resourceId === resourceB.id);

          const unlinked = !linkA ? a : !linkB ? b : null;
          if (unlinked) {
            withheld.push({
              source: "infra",
              fromMember: a.prefix,
              toMember: b.prefix,
              reason:
                `both declare ${what}, but ${unlinked.prefix} links it to no code — ` +
                `nothing in its source names the resource`,
              confidence: "inferred",
            });
            continue;
          }

          const endA = resolveInfraEndpoint(a, linkA!, fileToZone, zonesById);
          const endB = resolveInfraEndpoint(b, linkB!, fileToZone, zonesById);
          if (!endA || !endB) continue;

          const key = `${endA.file}\0${endB.file}\0${resourceA.id}\0${resourceB.id}`;
          if (seen.has(key)) continue;
          seen.add(key);

          crossings.push({
            from: endA.file,
            to: endB.file,
            fromZone: endA.zone,
            toZone: endB.zone,
            source: "infra",
            evidence:
              `${a.prefix} and ${b.prefix} both reference ${what} ` +
              `(${confidence === "certain" ? "same resource id" : "same name"}, ` +
              `from each member's infrastructure.json)`,
          });
        }
      }
    }
  }

  return { crossings, withheld };
}

// ── Combined ─────────────────────────────────────────────────────────────────

/** File → zone id over the promoted graph. */
function buildFileToZone(promotedZones: Zone[]): Map<string, string> {
  const fileToZone = new Map<string, string>();
  for (const zone of promotedZones) {
    for (const file of zone.files) fileToZone.set(file, zone.id);
  }
  return fileToZone;
}

/**
 * Every cross-repo edge, from all three sources, with the near-misses.
 *
 * The one entry point the aggregator calls. The three computations stay
 * separate functions because they read different artifacts and grade on
 * different evidence, but they are combined here rather than in the
 * aggregator — edge derivation is this module's job.
 */
export function computeCrossRepoEdges(
  members: SubAnalysis[],
  promotedZones: Zone[],
  packageMap: Map<string, PackageMapEntry>,
): CrossRepoEdges {
  const npm = computeCrossRepoCrossings(members, promotedZones, packageMap);
  const http = computeHttpCrossings(members, promotedZones);
  const infra = computeInfraCrossings(members, promotedZones);

  return {
    crossings: [...npm, ...http.crossings, ...infra.crossings],
    withheld: [...http.withheld, ...infra.withheld],
  };
}

/** Count crossings by source. Intra-repo crossings carry none and are `none`. */
export function countCrossingsBySource(
  crossings: ZoneCrossing[],
): Record<CrossingSource | "none", number> {
  const counts: Record<CrossingSource | "none", number> = {
    none: 0,
    npm: 0,
    http: 0,
    infra: 0,
  };
  for (const crossing of crossings) counts[crossing.source ?? "none"]++;
  return counts;
}
