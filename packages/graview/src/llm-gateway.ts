/**
 * Centralized gateway for `@n-dx/llm-client` runtime imports.
 *
 * The projection needs the foundation tier for two things only: where a
 * project keeps its state (the layout resolver owns `.ndx/graview` versus
 * `.graview`, as it owns every other n-dx path, and the per-user home that
 * holds the hub registry and the auth token) and how to spawn the graview
 * binary without importing `node:child_process` here. The project config is
 * read through the trust gate, so a repository's `graview.bin` is not spawned
 * until the user trusts the checkout, and every child gets `repoCommandEnv`'s
 * sanitized environment, never the whole of `process.env`.
 *
 * @module graview/llm-gateway
 * @see ./rex-gateway.ts — the rex PRD model
 * @see ./sourcevision-gateway.ts — sourcevision's output schema
 * @see ./hench-gateway.ts — hench's run record type
 */
export {
  resolveLayout,
  relativeToRoot,
  resolveNdxHome,
  spawnCli,
  repoCommandEnv,
  execStdout,
  trustedProjectConfig,
  trustedLocalConfig,
} from "@n-dx/llm-client";
export type { Layout, SpawnToolResult } from "@n-dx/llm-client";
