/**
 * Backward-compatibility re-export.
 *
 * `execShell` now lives in `tools/exec-shell.ts` so tool implementations
 * do not need to back-import from `process`.
 */
export { execShell } from "../tools/exec-shell.js";
export type { ExecShellOptions } from "../tools/exec-shell.js";
