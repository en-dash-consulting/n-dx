/**
 * Where the host-wide validation slot lives:
 * `<ndx home>/validation-slot/<host>/`.
 *
 * The host subdirectory keeps the slot per host when several hosts share one
 * ndx home (a network home directory): a holder's liveness is judged by pid
 * and boot time, which mean nothing on another host, so a shared directory
 * would let each host reclaim the other's live record.
 *
 * Kept apart from `validation-slot.ts` so the protocol module imports only
 * `node:` builtins; the ndx home's lookup order is llm-client's, reached
 * through the gateway.
 *
 * @module hench/process/validation-slot-dir
 */

import { hostname } from "node:os";
import { join } from "node:path";
import { resolveNdxHome } from "../prd/llm-gateway.js";
import { VALIDATION_SLOT_DIRNAME } from "./validation-slot.js";

/** The host directory's name when the hostname leaves nothing usable. */
export const VALIDATION_SLOT_FALLBACK_HOST = "unknown-host";

/**
 * The host directory's name: `name` lower-cased, each character outside
 * `[a-z0-9._-]` replaced by `-`. A name that is empty or only dots (which
 * would name the slot root or its parent) becomes the fallback.
 */
export function validationSlotHostDirname(name: string = hostname()): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return /^\.*$/.test(sanitized) ? VALIDATION_SLOT_FALLBACK_HOST : sanitized;
}

/** This host's slot directory under the ndx home `env` resolves to. */
export function resolveValidationSlotDir(
  env: NodeJS.ProcessEnv = process.env,
  host: string = hostname(),
): string {
  return join(resolveNdxHome({ env }), VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(host));
}
