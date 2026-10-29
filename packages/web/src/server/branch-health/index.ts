/**
 * Branch health: rule-based, LLM-free status of one worktree's branch.
 *
 * `collect.ts` reads git (and gh, when allowed); `checks.ts` classifies failing
 * PR checks. `routes-branch-health.ts` serves the result. The Sidecar's
 * Diagnose branch lens and the hub narrate it later; nothing here asks a model.
 *
 * @module web/server/branch-health
 */

export { collectBranchHealth, LOCAL_ONLY_REASON, NotAGitBranchError, parseMergeTree } from "./collect.js";
export type { CollectOptions } from "./collect.js";
export {
  capLogTail,
  classifyFailingCheck,
  cleanLog,
  failedTestFileRefs,
  failedTestFiles,
  parseRollup,
  LOG_TAIL_MAX_CHARS,
  LOG_TAIL_MAX_LINES,
} from "./checks.js";
export type * from "./types.js";
