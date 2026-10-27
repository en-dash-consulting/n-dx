/**
 * The environment for a command the repository owns or influences.
 *
 * The test gate, post-task tests, the dependency audit, requirement
 * validation commands, the cleanup typecheck and rex's `verify_criteria` run
 * a command string that comes from the repository (its config, its PRD, its
 * `package.json` scripts). They used to inherit the whole parent environment,
 * so a test script could read every credential the agent's shell is denied.
 * Every such caller takes its environment from {@link repoCommandEnv}.
 *
 * The policy is the project's `guard.env`, applied by
 * {@link sanitizeChildEnv}, with one difference from the agent's shell: an
 * `allow` entry the repository ships (`.hench/config.json`, the project
 * config's `hench` section) is honoured only while the repository is trusted
 * (`baseline` or `trusted`, see {@link evaluateRepoTrust}). The user's own
 * local config (`.n-dx.local.json`, git-ignored) is theirs, so its entries
 * always apply. `deny` entries can only remove variables and always apply.
 *
 * @module llm-client/repo-command-env
 */

import { readFileSync } from "node:fs";
import { compileEnvPolicy, sanitizeChildEnv } from "./child-env.js";
import { resolveLayout } from "./layout.js";
import {
  assessRepoExecutionConfig,
  collectRepoExecutionConfig,
  isRestrictedState,
  readRepoTrustRecord,
  repoTrustState,
  type RepoTrustStoreOptions,
} from "./repo-trust.js";

export interface RepoCommandEnvOptions {
  /** The parent environment to filter. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Where the user's trust store is. Defaults to the real one, located from
   * `process.env`. Never taken from `env`: a caller filtering an environment
   * that has already lost `NDX_HOME` would otherwise read a trust record
   * other than the one the user wrote.
   */
  trust?: RepoTrustStoreOptions;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** `hench.guard.env` from the user's git-ignored local config, if any. */
function localEnvPolicy(projectDir: string): { allow: string[]; deny: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolveLayout(projectDir).localConfigFile, "utf-8"));
  } catch {
    return { allow: [], deny: [] };
  }
  const env = (parsed as { hench?: { guard?: { env?: { allow?: unknown; deny?: unknown } } } } | null)
    ?.hench?.guard?.env;
  return { allow: stringList(env?.allow), deny: stringList(env?.deny) };
}

/**
 * A copy of the parent environment for a repository-owned command, with the
 * credential-shaped variables the project's policy strips removed. Never
 * throws: an unreadable config yields the default policy, which is the
 * strictest one.
 */
export function repoCommandEnv(projectDir: string, options: RepoCommandEnvOptions = {}): NodeJS.ProcessEnv {
  const config = collectRepoExecutionConfig(projectDir);
  const state = repoTrustState(
    config,
    assessRepoExecutionConfig(config),
    readRepoTrustRecord(projectDir, options.trust),
  );
  const local = localEnvPolicy(projectDir);
  const policy = compileEnvPolicy({
    deny: [...config.envDeny, ...local.deny],
    allow: [...(isRestrictedState(state) ? [] : config.envAllow), ...local.allow],
  });
  return sanitizeChildEnv(options.env ?? process.env, policy);
}
