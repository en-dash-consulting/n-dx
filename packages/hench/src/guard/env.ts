/**
 * Child-process environment filtering.
 *
 * Every command the agent runs inherited the whole of `process.env`, so a
 * shell step chosen by the model (or by a prompt the model read in the repo)
 * could print `$AWS_SECRET_ACCESS_KEY` or `$GITHUB_TOKEN` into a transcript,
 * or hand it to a `curl`. The agent's shell does not need those: it builds,
 * tests and inspects the project. This module strips variables whose names
 * look like credentials before anything is spawned, and lets a project list
 * the ones its tests legitimately need.
 *
 * Matching is by name only — values are never inspected — and it is applied
 * to the agent's own tool processes (shell, git, test runner). The vendor CLI
 * hench drives (`claude`, `codex`) is spawned elsewhere with the environment
 * it needs to authenticate; see `@n-dx/llm-client`'s providers.
 *
 * @module hench/guard/env
 */

import type { EnvPolicyConfig } from "./contracts.js";

/** Name globs stripped by default. `*` matches any run of characters; matching ignores case. */
export const DEFAULT_ENV_DENY: readonly string[] = [
  "*TOKEN*",
  "*SECRET*",
  "*PASSWORD*",
  "*PASSWD*",
  "*_API_KEY",
  "*APIKEY*",
  "*PRIVATE_KEY*",
  "*CREDENTIALS*",
  "*_AUTH",
  "AWS_*",
  "AZURE_*",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCLOUD_*",
  "DOCKER_PASSWORD",
  "NPM_CONFIG__AUTH*",
  "NPM_CONFIG_*TOKEN*",
];

/**
 * Variables that match a deny glob by shape but are plumbing, not secrets.
 * `SSH_AUTH_SOCK` is a socket path git needs; the vitest/npm entries are
 * booleans or paths.
 */
export const DEFAULT_ENV_ALLOW: readonly string[] = [
  "SSH_AUTH_SOCK",
  "GIT_ASKPASS",
  "NPM_CONFIG_USERCONFIG",
];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function compile(globs: readonly string[]): RegExp[] {
  return globs.map(globToRegExp);
}

/** Resolved, compiled policy — build once per guard, apply per spawn. */
export interface EnvPolicy {
  deny: RegExp[];
  allow: RegExp[];
}

export function compileEnvPolicy(config: EnvPolicyConfig | undefined): EnvPolicy {
  return {
    deny: compile([...DEFAULT_ENV_DENY, ...(config?.deny ?? [])]),
    allow: compile([...DEFAULT_ENV_ALLOW, ...(config?.allow ?? [])]),
  };
}

/** Whether a variable of this name survives the policy. */
export function envNameAllowed(name: string, policy: EnvPolicy): boolean {
  if (policy.allow.some((re) => re.test(name))) return true;
  return !policy.deny.some((re) => re.test(name));
}

/**
 * Copy `env` without the variables the policy strips. Never mutates the
 * input, and never touches values.
 */
export function sanitizeChildEnv(env: NodeJS.ProcessEnv, policy: EnvPolicy): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (envNameAllowed(name, policy)) out[name] = value;
  }
  return out;
}

/** The names `sanitizeChildEnv` would drop, for a warning or an audit line. */
export function strippedEnvNames(env: NodeJS.ProcessEnv, policy: EnvPolicy): string[] {
  return Object.keys(env).filter((name) => env[name] !== undefined && !envNameAllowed(name, policy)).sort();
}
