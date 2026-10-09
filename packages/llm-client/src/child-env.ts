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
 * to tool processes and vendor CLIs. Vendor CLIs retain only their own
 * authentication variables in addition to the project's explicit allowlist.
 *
 * @module llm-client/child-env
 */

import type { LLMConfig } from "./llm-types.js";
import { DEFAULT_LLM_VENDOR, LLM_VENDOR } from "./provider-interface.js";

export interface EnvPolicyConfig {
  /** Additional case-insensitive variable-name globs to strip. */
  deny?: string[];
  /** Variable-name globs to retain even when a deny glob matches. */
  allow?: string[];
}

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

/** Filter a vendor CLI's environment without exposing unrelated credentials. */
export function resolveVendorCliEnv(
  config: LLMConfig,
  envConfig?: EnvPolicyConfig,
  source: NodeJS.ProcessEnv = process.env,
  onStripped?: (names: string[]) => void,
): NodeJS.ProcessEnv {
  const vendor = config.vendor ?? DEFAULT_LLM_VENDOR;
  const policy = compileEnvPolicy(envConfig);
  const env = sanitizeChildEnv(source, policy);
  const keyName = vendor === LLM_VENDOR.CODEX ? "OPENAI_API_KEY"
    : vendor === LLM_VENDOR.GOOGLE ? config.google?.apiKeyEnv ?? "GEMINI_API_KEY"
    : vendor === LLM_VENDOR.CLAUDE ? "ANTHROPIC_API_KEY" : undefined;
  // Exact names, not globs: a custom apiKeyEnv must not widen credential access.
  const authNames = vendor === LLM_VENDOR.CLAUDE
    ? ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]
    : vendor === LLM_VENDOR.CODEX
      ? ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_HOME"]
      : keyName ? [keyName] : [];
  if (vendor === LLM_VENDOR.CLAUDE) {
    const modeEnabled = (flag: string): boolean => Object.entries(env).some(([name, value]) =>
      name.toUpperCase() === flag && value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase()));
    // Keep exact cloud authentication names only for the mode the child will use.
    if (modeEnabled("CLAUDE_CODE_USE_BEDROCK")) authNames.push(
      "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
      "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE",
      "AWS_BEARER_TOKEN_BEDROCK",
    );
    if (modeEnabled("CLAUDE_CODE_USE_VERTEX")) authNames.push("GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_ML_REGION");
  }
  const authSet = new Set(authNames.map((name) => name.toUpperCase()));
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && authSet.has(name.toUpperCase())) env[name] = value;
  }
  const apiKey = vendor === LLM_VENDOR.CODEX ? config.codex?.api_key
    : vendor === LLM_VENDOR.GOOGLE ? config.google?.api_key
    : vendor === LLM_VENDOR.CLAUDE ? config.claude?.api_key : undefined;
  if (keyName && apiKey) {
    // Windows treats environment names case-insensitively. Avoid duplicate keys
    // with different casing that could shadow the configured credential.
    for (const name of Object.keys(env)) {
      if (name.toUpperCase() === keyName.toUpperCase()) delete env[name];
    }
    env[keyName] = apiKey;
  }
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === "CLAUDECODE") delete env[name];
  }
  const stripped = strippedEnvNames(source, policy).filter((name) => !authSet.has(name.toUpperCase()));
  if (stripped.length > 0) onStripped?.(stripped);
  return env;
}
