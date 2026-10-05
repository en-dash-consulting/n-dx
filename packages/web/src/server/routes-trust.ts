/**
 * Repository trust routes — the dashboard's view of what this checkout ships
 * as execution config, and the one place a user accepts it from the UI.
 *
 *   GET  /api/trust          evaluation: state, findings, inventory, sources
 *   POST /api/trust/accept   record the current digest as trusted; returns the new evaluation
 *   POST /api/trust/revoke   forget the decision; returns the new evaluation
 *
 * The evaluation comes from `@n-dx/llm-client`'s `repo-trust` module, the
 * same code hench applies at run start and `ndx init` prints, so the banner,
 * the CLI warning and the clamp cannot disagree. The record is written to
 * the per-user ndx home, never into the repository.
 *
 * The POSTs are mutations and so pass the request gate's origin rule like
 * every other write route; a page that is not the dashboard cannot trust a
 * repository on the user's behalf.
 *
 * @module web/server/routes-trust
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { clearRepoTrust, evaluateRepoTrust, recordRepoTrust } from "@n-dx/llm-client";
import type { RepoTrustEvaluation } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./response-utils.js";

const TRUST_PATH = "/api/trust";

/** The wire shape: the evaluation minus the absolute trust-file path, which is the user's business, not the page's. */
export interface TrustResponse {
  state: RepoTrustEvaluation["state"];
  restricted: boolean;
  findings: RepoTrustEvaluation["findings"];
  inventory: RepoTrustEvaluation["inventory"];
  sources: string[];
  digest: string;
  trustedAt: string | null;
}

export function toTrustResponse(ev: RepoTrustEvaluation): TrustResponse {
  return {
    state: ev.state,
    restricted: ev.restricted,
    findings: ev.findings,
    inventory: ev.inventory,
    sources: ev.config.sources,
    digest: ev.config.digest,
    trustedAt: ev.record?.trustedAt ?? null,
  };
}

export async function handleTrustRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = (req.url ?? "/").split("?")[0];
  if (url !== TRUST_PATH && !url.startsWith(`${TRUST_PATH}/`)) return false;
  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (url === TRUST_PATH && method === "GET") {
      jsonResponse(res, 200, toTrustResponse(evaluateRepoTrust(ctx.projectDir)));
      return true;
    }
    if (url === `${TRUST_PATH}/accept` && method === "POST") {
      recordRepoTrust(ctx.projectDir);
      jsonResponse(res, 200, toTrustResponse(evaluateRepoTrust(ctx.projectDir)));
      return true;
    }
    if (url === `${TRUST_PATH}/revoke` && method === "POST") {
      clearRepoTrust(ctx.projectDir);
      jsonResponse(res, 200, toTrustResponse(evaluateRepoTrust(ctx.projectDir)));
      return true;
    }
  } catch (err) {
    errorResponse(res, 500, err instanceof Error ? err.message : "Trust evaluation failed");
    return true;
  }

  errorResponse(res, 405, `${method} not allowed on ${url}`);
  return true;
}
