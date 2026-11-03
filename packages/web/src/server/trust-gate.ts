/**
 * The dashboard's repository-trust gate.
 *
 * A repository's tracked n-dx configuration can widen what runs on the
 * operator's machine — extra agent commands, a test command, a CLI path, an
 * API endpoint. `ndx work` already refuses to apply such a configuration until
 * the operator has reviewed and accepted it (`ndx trust accept .`), and the
 * dashboard follows the same decision: every route whose spawned binary or
 * argv derives from repository content asks {@link refuseWhileRestricted}
 * first, and answers 403 while the repository is restricted.
 *
 * The decision itself is `isRepoRestricted` from `@n-dx/llm-client` — the
 * same function the CLI consults — so the dashboard and the CLI cannot
 * disagree about which repositories are trusted.
 *
 * @module web/server/trust-gate
 */

import type { ServerResponse } from "node:http";
import { isRepoRestricted } from "@n-dx/llm-client";
import { jsonResponse } from "./response-utils.js";

/** The command that lifts the restriction, after a review. */
export const TRUST_HINT = "ndx trust accept .";

/** What a refused request is told. */
export const RESTRICTED_MESSAGE =
  "This repository's n-dx execution config has not been accepted on this machine, " +
  "so the dashboard will not run commands derived from it. Review it with 'ndx trust .', then accept it.";

/**
 * Whether `projectDir` is restricted. An evaluation that throws counts as
 * restricted: the gate fails closed rather than spawning on a guess.
 */
export function isProjectRestricted(projectDir: string): boolean {
  try {
    return isRepoRestricted(projectDir);
  } catch {
    return true;
  }
}

/**
 * Answer 403 `{ error, hint }` and return true while `projectDir` is
 * restricted; return false (and write nothing) otherwise.
 */
export function refuseWhileRestricted(res: ServerResponse, projectDir: string): boolean {
  if (!isProjectRestricted(projectDir)) return false;
  jsonResponse(res, 403, { error: RESTRICTED_MESSAGE, hint: TRUST_HINT, restricted: true });
  return true;
}
