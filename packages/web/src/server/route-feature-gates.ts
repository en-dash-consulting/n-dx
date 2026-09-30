/**
 * Server-side enforcement of the dashboard's feature toggles.
 *
 * A toggle that only hides a nav entry is a suggestion, not a gate: the
 * endpoints behind the hidden view stay open to anything that can reach the
 * port — another tab, a stale bookmark, `curl`, an MCP client, a second
 * dashboard build that does not know about the toggle. For a feature that
 * spends tokens on every call that is the difference between a default-off
 * experiment and an unmetered one.
 *
 * This module is the inventory of which endpoint belongs to which toggle, and
 * {@link enforceRouteFeatureGate} is the one place that refuses. It runs at the
 * top of `handleApiRoutes` (see start.ts), before scope filtering and before
 * any handler reads a body, so a disabled feature refuses for that reason
 * rather than for whichever other precondition the project happens to also be
 * missing.
 *
 * ## What belongs here
 *
 * Every endpoint governed by a key in `FEATURE_REGISTRY` (routes-features.ts),
 * including the endpoints a feature reaches through a side door. The Ask panel
 * is the worked example: `sourcevision.ask` is the only toggle over a
 * token-spending endpoint, and turning it off used to leave the panel's two
 * write endpoints (`capture-ask`, `apply-refinements`) reachable, because the
 * only thing that had ever hidden them was the sidebar.
 *
 * `route-feature-gates.test.ts` fails when a nav `featureGate` in the viewer's
 * sidebar has no entry here, so a toggle cannot go back to being nav-only.
 *
 * ## What does not belong here
 *
 * Endpoints with no governing toggle. Several token-spending routes have none
 * today — `/api/commands/recommend`, `/api/rex/analyze`, `/api/commands/ci` —
 * and inventing a flag per endpoint to give them one would be a product
 * decision made by a gate registry. If a toggle is added for them, the
 * completeness test above forces the endpoint entry in the same change.
 *
 * Likewise `/api/commands/sync`: `rex.notionSync` names one adapter and the
 * command syncs with whichever adapter is configured, so the mapping is not
 * one-to-one and guessing it would refuse a sync the toggle never described.
 *
 * @module web/server/route-feature-gates
 * @see routes-features.ts — the toggle registry and `isFeatureEnabled`
 * @see routes-sourcevision-ask.ts — the one self-enforcing gate, and why
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse } from "./response-utils.js";
import { isFeatureEnabled } from "./routes-features.js";

/** One toggle and the endpoints it governs. */
export interface RouteFeatureGate {
  /** Registry key from routes-features.ts, e.g. "sourcevision.ask". */
  feature: string;
  /** Paths this gate covers exactly (query string already stripped). */
  exact?: readonly string[];
  /** Path subtree this gate covers — the prefix itself and anything under it. */
  prefix?: string;
  /** Why these endpoints belong to this toggle. Read by humans, not code. */
  reason: string;
  /**
   * True when the route checks the toggle itself and must keep doing so.
   * {@link enforceRouteFeatureGate} steps over these: the route answers in a
   * shape its client already renders, and a generic refusal on top would
   * replace a specific message with a worse one. The entry stays here so the
   * inventory is complete and the completeness test can see it.
   */
  selfEnforced?: boolean;
}

/**
 * Every dashboard endpoint governed by a feature toggle.
 *
 * Grouped by toggle rather than by route file, because the question this
 * answers is "what does turning this off actually turn off".
 */
export const ROUTE_FEATURE_GATES: readonly RouteFeatureGate[] = [
  {
    feature: "sourcevision.ask",
    exact: ["/api/sourcevision/ask"],
    reason:
      "The question itself — the only endpoint in the dashboard that spends tokens per call behind a toggle.",
    selfEnforced: true,
  },
  {
    feature: "sourcevision.ask",
    exact: ["/api/rex/capture-ask", "/api/rex/apply-refinements"],
    reason:
      "The Ask panel's two write endpoints. Nothing but the panel posts to them, so they are off when the panel is.",
  },
  {
    feature: "sourcevision.prMarkdown",
    exact: ["/api/sv/pr-markdown", "/api/sv/pr-markdown/state"],
    reason: "Reads for the PR Markdown page. Listed exactly so an unrelated subpath is still a 404, not a 403.",
  },
  {
    feature: "rex.notionSync",
    prefix: "/api/notion",
    reason: "Notion credentials, connection tests and schema writes — the whole Notion settings surface.",
  },
  {
    feature: "rex.integrations",
    prefix: "/api/integrations",
    reason: "Integration schemas and saved adapter credentials, including secrets, read and written here.",
  },
];

/** The gate covering `pathname`, or null when the path is ungated. */
export function findRouteFeatureGate(pathname: string): RouteFeatureGate | null {
  for (const gate of ROUTE_FEATURE_GATES) {
    if (gate.exact?.includes(pathname)) return gate;
    if (gate.prefix && (pathname === gate.prefix || pathname.startsWith(`${gate.prefix}/`))) {
      return gate;
    }
  }
  return null;
}

/**
 * The refusal body, which names the flag twice on purpose: once as a field the
 * viewer can branch on, and once in prose, because the reader of a raw 403 is
 * usually a terminal and has nothing else to go on.
 */
export interface FeatureDisabledResponse {
  error: string;
  /** The registry key that is off. */
  feature: string;
  /** Discriminator, matching the ask route's `kind` convention. */
  kind: "feature_disabled";
  suggestion: string;
}

/** The 403 body for a disabled `feature` reached at `pathname`. */
export function featureDisabledBody(feature: string, pathname: string): FeatureDisabledResponse {
  return {
    error: `The feature "${feature}" is turned off for this project, so ${pathname} refused the request.`,
    feature,
    kind: "feature_disabled",
    suggestion:
      `Enable ${feature} in the Feature Toggles view, or set features.${feature} to true in .n-dx.json.`,
  };
}

/**
 * Refuse the request when its endpoint's toggle is off.
 *
 * @returns true when it answered — the caller must stop dispatching.
 */
export function enforceRouteFeatureGate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const pathname = (req.url || "/").split("?")[0];
  const gate = findRouteFeatureGate(pathname);
  if (!gate || gate.selfEnforced) return false;
  if (isFeatureEnabled(ctx.projectDir, gate.feature)) return false;

  jsonResponse(res, 403, featureDisabledBody(gate.feature, pathname));
  return true;
}
