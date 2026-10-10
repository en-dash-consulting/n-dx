/**
 * Centralized gateway for `@n-dx/llm-client` runtime imports.
 *
 * The projection needs the foundation tier for two things only: where a
 * project keeps its state (the layout resolver owns `.ndx/graview` versus
 * `.graview`, as it owns every other n-dx path) and how to spawn the graview
 * binary without importing `node:child_process` here.
 *
 * @module graview/llm-gateway
 * @see ./rex-gateway.ts — the rex PRD model
 * @see ./sourcevision-gateway.ts — sourcevision's output schema
 * @see ./hench-gateway.ts — hench's run record type
 */
export { resolveLayout, relativeToRoot, spawnTool } from "@n-dx/llm-client";
export type { Layout, SpawnToolResult } from "@n-dx/llm-client";
