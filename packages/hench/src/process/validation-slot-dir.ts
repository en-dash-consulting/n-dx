/**
 * Where the host-wide validation slot lives: `<ndx home>/validation-slot/`.
 *
 * Kept apart from `validation-slot.ts` so the protocol module imports only
 * `node:` builtins; the ndx home's lookup order is llm-client's, reached
 * through the gateway.
 *
 * @module hench/process/validation-slot-dir
 */

import { join } from "node:path";
import { resolveNdxHome } from "../prd/llm-gateway.js";
import { VALIDATION_SLOT_DIRNAME } from "./validation-slot.js";

/** The slot directory under the ndx home `env` resolves to. */
export function resolveValidationSlotDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveNdxHome({ env }), VALIDATION_SLOT_DIRNAME);
}
