/**
 * Wire types for `GET /api/branch-health`.
 *
 * Shared by the collector, the route and (structurally) the Workspaces board,
 * which declares its own copy because the viewer never imports the server.
 *
 * @module web/server/branch-health/types
 */

import type { ExecOptions, ExecResult } from "@n-dx/llm-client";

/** Runs one command. The llm-client `exec` in production; a stub in tests. */
export type BranchHealthExec = (cmd: string, args: string[], opts: ExecOptions) => Promise<ExecResult>;

/**
 * Where `base` came from, in precedence order. `pr-cached` is the PR base an
 * earlier GitHub read found, reused by a local-only answer.
 */
export type BaseSource = "pr" | "pr-cached" | "upstream" | "default";

/** One file `git merge-tree --write-tree` could not merge, with the index stages it left. */
export interface PredictedConflict {
  path: string;
  /** 1 = common ancestor, 2 = base, 3 = this branch. A missing stage is a side that deleted the file. */
  stages: number[];
}

/** One layer below this branch in its base chain. */
export interface StackLayer {
  branch: string;
  /** Whether that layer's tip is an ancestor of HEAD. A base set without its content is not a stack. */
  contained: boolean;
}

/** Why a check failed, by fixed rules over its name, its log and the branch. */
export type CheckFailureClass =
  | "behind-base"
  | "policy-test"
  | "codeql"
  | "touched-test"
  | "fork-no-ci"
  | "unclassified";

/** One failing check of the PR. */
export interface FailingCheck {
  name: string;
  /** The check's conclusion or state as GitHub reports it, e.g. `FAILURE`. */
  conclusion: string;
  url: string | null;
  class: CheckFailureClass;
  /** The fact that decided the class, in a sentence. */
  evidence: string;
  /** The tail of `gh run view --log-failed`; null when no Actions log exists for the check. */
  logTail: string | null;
}

/** PR facts, present only when GitHub reads are allowed and gh answered. */
export interface GithubFacts {
  number: number;
  url: string;
  baseRefName: string;
  isCrossRepository: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  checks: { total: number; failing: number; pending: number };
  failing: FailingCheck[];
}

export interface BranchHealth {
  /** Null on a detached HEAD. */
  branch: string | null;
  head: string;
  /** The ref compared against, e.g. `origin/main`; null when none could be found. */
  base: string | null;
  baseSource: BaseSource | null;
  /**
   * Why `base` may not be the PR's base: set when GitHub reads are allowed but
   * deferred and no earlier read found the PR base. Null otherwise.
   */
  baseNote: string | null;
  /** Null when there is no base. */
  ahead: number | null;
  behind: number | null;
  conflicts: PredictedConflict[];
  /** Why conflicts could not be predicted (e.g. a git older than 2.38); null when they were. */
  conflictsUnavailable: string | null;
  stack: StackLayer[];
  github: GithubFacts | null;
  /** Why `github` is null; null when it is not. */
  githubReason: string | null;
  /**
   * True when GitHub reads are allowed but only local facts were asked for:
   * asking again with `?github=1` reads the PR, its checks and the stack's PR bases.
   */
  githubDeferred: boolean;
}
