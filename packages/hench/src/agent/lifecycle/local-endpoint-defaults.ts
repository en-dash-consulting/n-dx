/**
 * Where the local (OpenAI-compatible) vendor's servers are reached when
 * `llm.local` leaves a host or port unset.
 *
 * Its own module, rather than a corner of `loop.ts`, because the `hench run`
 * preflight reads the same defaults: tests that replace `loop.js` with an
 * `agentLoop`-only mock would otherwise take these constants away from it too.
 *
 * @module
 */

/**
 * Where llm.local points when its host or port is unset: LM Studio on this
 * machine. llm-client exports the canonical DEFAULT_LOCAL_HOST and
 * DEFAULT_LOCAL_PORT, but the llm-gateway is at its export ceiling, so hench
 * keeps this one copy (the run preflight reads it too) and
 * `tests/unit/agent/lifecycle/local-endpoint-defaults.test.ts` pins the two equal.
 */
export const DEFAULT_LOCAL_HOST = "localhost";
export const DEFAULT_LOCAL_PORT = 1234;

/** Port the second-model verifier is queried on when llm.local.verifier.port is unset. */
export const DEFAULT_VERIFIER_PORT = 1235;
