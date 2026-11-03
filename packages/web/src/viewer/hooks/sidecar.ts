/**
 * The hooks the Sidecar drawer chain needs, and nothing else.
 *
 * `hooks/index.ts` re-exports every hook, including `use-app-data`, which
 * pulls zod and the loader into whatever imports it. esbuild cannot drop those
 * (the package does not declare itself free of side effects), so the hub
 * session page (`hub-session.ts`) imports the drawer through this narrow
 * barrel and `sidecar/index.ts`. Add a hook here only when the drawer chain
 * uses it. `tests/integration/hub-session-bundle.test.ts` fails when zod or
 * `loader/` comes back.
 *
 * @module viewer/hooks/sidecar
 */

export * from "./use-sidecar.js";
export * from "./use-sidecar-attachment.js";
export * from "./use-sidecar-sessions.js";
export * from "./use-hub-session.js";
export * from "./use-product-read.js";
export { DEFAULT_CLI_NAME, useCliName } from "./use-project-metadata.js";
