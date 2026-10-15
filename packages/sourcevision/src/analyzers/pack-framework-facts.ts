/**
 * Language packs' framework facts in the artifacts sourcevision already
 * writes: `routes` facts become `serverRoutes` groups in components.json,
 * `outboundCalls` facts become `outbound.json` dependencies.
 *
 * The imports phase collects these facts in the same pack call that reads
 * imports (`PackImportsOptions.framework`), so no file is parsed twice; a
 * phase run on its own reads them with `readImportsPackFrameworkFacts`. The
 * facts pass the role filters the existing detectors apply
 * ({@link ROUTE_SKIP_ROLES}, outbound's {@link SKIP_ROLES}). With no facts,
 * each merge returns its input unchanged.
 *
 * @module sourcevision/analyzers/pack-framework-facts
 */

import type { FileFacts } from "@n-dx/lang-kit";
import type { HttpMethod, Inventory, OutboundData, OutboundDependency, ServerRoute, ServerRouteGroup } from "../schema/index.js";
import { sortOutbound } from "../util/sort.js";
import { inferPrefix } from "./go-route-detection.js";
import { SKIP_ROLES } from "./outbound-detection.js";
import { ROUTE_SKIP_ROLES } from "./server-route-detection.js";

/** The routes and outbound-call facts packs returned for one analysis. */
export type PackFrameworkFacts = readonly Pick<FileFacts, "path" | "routes" | "outboundCalls">[];

const HTTP_METHODS: ReadonlySet<string> = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

/** Path → role, for the files `facts` name. */
function rolesOf(inventory: Inventory): Map<string, string> {
  return new Map(inventory.files.map((f) => [f.path, f.role]));
}

/**
 * One group per file with routes. A route without a method accepts any
 * method; like `http.HandleFunc` in the Go detector, it is recorded as GET
 * since that's the most common use, but the handler accepts any method. A
 * method outside {@link HttpMethod} (TRACE) is dropped, and a repeated
 * method and path keeps its first handler, as in the other detectors.
 */
export function packRouteGroups(facts: PackFrameworkFacts, inventory: Inventory): ServerRouteGroup[] {
  const roles = rolesOf(inventory);
  const groups: ServerRouteGroup[] = [];
  for (const { path: file, routes: found } of facts) {
    const role = roles.get(file);
    if (!found?.length || role === undefined || ROUTE_SKIP_ROLES.has(role)) continue;
    const routes: ServerRoute[] = [];
    const seen = new Set<string>();
    for (const fact of found) {
      const method = fact.method ?? "GET";
      if (!HTTP_METHODS.has(method)) continue;
      const key = `${method} ${fact.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ file, method: method as HttpMethod, path: fact.path, ...(fact.handler === undefined ? {} : { handler: fact.handler }) });
    }
    if (routes.length === 0) continue;
    routes.sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));
    groups.push({ file, prefix: inferPrefix(routes), routes });
  }
  return groups;
}

/**
 * `groups` with the packs' route groups added, in the detectors' file
 * order. Without pack routes, `groups` itself.
 */
export function withPackRouteGroups(
  groups: ServerRouteGroup[],
  inventory: Inventory,
  facts: PackFrameworkFacts | undefined,
): ServerRouteGroup[] {
  const added = facts ? packRouteGroups(facts, inventory) : [];
  if (added.length === 0) return groups;
  // Stable: the detectors' groups keep their order among themselves.
  return [...groups, ...added].sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * One dependency per outbound-call fact, deduplicated per file on line,
 * kind, client and target as the detectors do. A fact without a confidence
 * is `inferred`.
 */
export function packOutboundDependencies(facts: PackFrameworkFacts, inventory: Inventory): OutboundDependency[] {
  const roles = rolesOf(inventory);
  const dependencies: OutboundDependency[] = [];
  for (const { path: file, outboundCalls } of facts) {
    const role = roles.get(file);
    if (!outboundCalls?.length || role === undefined || SKIP_ROLES.has(role)) continue;
    const seen = new Set<string>();
    for (const call of outboundCalls) {
      const line = call.position.line;
      const key = `${line}|${call.kind}|${call.client}|${call.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.push({
        file,
        line,
        kind: call.kind,
        target: call.target,
        targetSource: call.targetSource,
        client: call.client,
        confidence: call.confidence ?? "inferred",
      });
    }
  }
  return dependencies;
}

/** `data` with the packs' outbound calls added and sorted canonically. Without any, `data` itself. */
export function withPackOutbound(data: OutboundData, inventory: Inventory, facts: PackFrameworkFacts | undefined): OutboundData {
  const added = facts ? packOutboundDependencies(facts, inventory) : [];
  if (added.length === 0) return data;
  return sortOutbound({ dependencies: [...data.dependencies, ...added], contracts: data.contracts });
}
