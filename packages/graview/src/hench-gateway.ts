/**
 * Centralized gateway for `@n-dx/hench` imports.
 *
 * Runs live as JSON under the hench directory (`runs/<id>.json`, or
 * `.json.gz`); the projection reads them off disk against the type hench
 * publishes, and totals a run's tokens the way hench does — older records
 * carry only the raw `tokenUsage`, and `normalizeRunTokens` is the one
 * definition of how that becomes input, output, cached and total.
 *
 * @module graview/hench-gateway
 * @see ./rex-gateway.ts — the rex PRD model
 * @see ./sourcevision-gateway.ts — sourcevision's output schema
 * @see ./llm-gateway.ts — layout and spawning
 */
export { normalizeRunTokens } from "@n-dx/hench";
export type { RunRecord, RunTokens } from "@n-dx/hench";
