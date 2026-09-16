/**
 * The hub's only import surface from `@n-dx/llm-client`. Re-export only.
 *
 * The hub spawns and stops one dashboard server per registered project. It
 * never imports `node:child_process` (tests/e2e/architecture-policy.test.js
 * forbids that in web); process control comes from the foundation tier's
 * exec helpers, and this file is where the hub's dependency on them is
 * declared so it can be audited in one place.
 *
 * @module web/hub/exec-gateway
 */

export { spawnManaged, killWithFallback } from "@n-dx/llm-client";
export type { ManagedChild } from "@n-dx/llm-client";
