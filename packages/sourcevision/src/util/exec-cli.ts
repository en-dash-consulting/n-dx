/**
 * Windows-safe synchronous CLI helper for sourcevision.
 *
 * A re-export of llm-client's `execFileSyncCli`, so the one cmd.exe recipe —
 * verbatim quoting, the `%VAR%` and line-break refusal, `/v:off`, no console
 * window — lives in one place. This file once carried its own copy of the
 * recipe without the refusal; the import is what keeps the two from drifting
 * again. Sourcevision depends on @n-dx/llm-client (see package.json).
 *
 * Used by branch-work-collector and analyze-progress to spawn `rex` and `ps`.
 */

export { execFileSyncCli } from "@n-dx/llm-client";
