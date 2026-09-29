/**
 * Web's paths module — the only place the dashboard names a project file of
 * its own.
 *
 * The three markers here are the dashboard's whole footprint in a project: a
 * PID file, a port file and the LLM spend ledger. Each was a bare string
 * literal at its read and write sites (`src/server/port.ts`,
 * `src/server/dashboard-usage.ts`, and `packages/core/web.js` on the
 * orchestration side), which meant the port file's name was written down in
 * three places that had to agree for `ndx start stop` to find a running server.
 *
 * Web reaches `@n-dx/llm-client` directly rather than through a gateway:
 * foundation-tier imports are gated only in hench
 * (`packages/core/gateway-rules.json`), and neither the rex nor the
 * sourcevision gateway should grow an export for a layout question that
 * belongs to neither domain.
 *
 * The rex and sourcevision directories the dashboard reads are *not* resolved
 * here — those belong to their own packages' paths modules and reach web
 * through the existing gateways.
 *
 * @module web/server/paths
 * @see packages/llm-client/src/layout.ts — the resolver and its lookup order
 */

import { resolveLayout, type ResolveLayoutOptions } from "@n-dx/llm-client";

/** The dashboard's own files inside a project. */
export interface WebPaths {
  /**
   * PID marker for a running dashboard.
   *
   * Carries the hub's port rather than this server's when the project is
   * registered with the hub, so a signal reaches the hub and is forwarded.
   */
  pidFile: string;
  /** Port marker, read by `ndx start stop` and `ndx refresh --live-server`. */
  portFile: string;
  /**
   * Append-only LLM spend ledger, one line per Ask call.
   *
   * Machine-local and not attributed to any PRD item; safe to delete.
   */
  usageFile: string;
}

/**
 * Resolve the dashboard's paths for a project root.
 *
 * @param root     Absolute project root.
 * @param options  Forwarded to {@link resolveLayout} — pass `{ mode }` to ask
 *                 for a layout by name rather than detecting one.
 */
export function resolveWebPaths(
  root: string,
  options?: ResolveLayoutOptions,
): WebPaths {
  const layout = resolveLayout(root, options);
  return {
    pidFile: layout.webPidFile,
    portFile: layout.webPortFile,
    usageFile: layout.webUsageFile,
  };
}
