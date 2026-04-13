/**
 * Re-export from polling zone.
 *
 * usePollingSuspension lives in the polling zone (where it is architecturally
 * co-located with polling-state, its primary dependency). This shim keeps the
 * hooks barrel backward-compatible for existing consumers.
 */
export { usePollingSuspension, type UsePollingSuspensionResult } from "../polling/use-polling-suspension.js";
