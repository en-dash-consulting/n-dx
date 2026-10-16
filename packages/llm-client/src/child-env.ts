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
import { codexUserEnvKey } from "./codex-user-config.js";
import { DEFAULT_LLM_VENDOR, LLM_VENDOR, isLLMVendor, type LLMVendor } from "./provider-interface.js";

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

/** What `onStripped` is reporting: names removed, or a cloud mode whose credentials never arrived. */
export type EnvReportKind = "stripped" | "missing-credentials";

/** Bedrock names that address or trust-anchor the endpoint but are not credentials. */
const BEDROCK_PLUMBING = ["AWS_REGION", "AWS_DEFAULT_REGION", "AWS_CA_BUNDLE"];
/** Bedrock credential names: static keys, profile/config files, bearer token, IRSA and ECS/Fargate. */
const BEDROCK_CREDENTIALS = [
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE", "AWS_CONFIG_FILE", "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
];

const TRUTHY = ["1", "true", "yes", "on"];

/**
 * Whether a mode flag is on. Names match exactly, as the vendor CLI reads
 * them; only Windows, whose environment names are case-insensitive, folds case.
 */
function modeEnabled(env: NodeJS.ProcessEnv, flag: string): boolean {
  const fold = process.platform === "win32";
  return Object.entries(env).some(([name, value]) =>
    (fold ? name.toUpperCase() === flag : name === flag)
    && value !== undefined && TRUTHY.includes(value.toLowerCase()));
}

/**
 * A way a vendor CLI authenticates beyond its default key. Its names are kept
 * only while `active` holds, and `active` reads only what the operator
 * controls: an exported flag, or the operator's own vendor config. Never
 * repository content, which could otherwise switch a mode on to pull its
 * credentials into the child.
 */
interface VendorMode {
  vendor: LLMVendor;
  /** Evaluated on the policy-filtered environment, so a denied flag leaves the mode off. */
  active: (env: NodeJS.ProcessEnv) => boolean;
  /** Exact names. At least one must reach the child, or the mode is reported as missing credentials. */
  credentials: (env: NodeJS.ProcessEnv) => readonly string[];
  /** Exact names that address the endpoint but are not secrets. */
  plumbing: readonly string[];
}

const flag = (name: string) => (env: NodeJS.ProcessEnv) => modeEnabled(env, name);
const names = (list: readonly string[]) => () => list;
function codexProviderKey(env: NodeJS.ProcessEnv): readonly string[] {
  const key = codexUserEnvKey(env);
  return key ? [key] : [];
}

/** Every vendor mode, one row each. Names are exact, never globs. */
const VENDOR_MODES: readonly VendorMode[] = [
  // Claude Code on Amazon Bedrock: https://code.claude.com/docs/en/amazon-bedrock
  {
    vendor: LLM_VENDOR.CLAUDE, active: flag("CLAUDE_CODE_USE_BEDROCK"),
    credentials: names(BEDROCK_CREDENTIALS), plumbing: BEDROCK_PLUMBING,
  },
  // Claude Code on Google Vertex AI: https://code.claude.com/docs/en/google-vertex-ai
  // (ANTHROPIC_VERTEX_PROJECT_ID passes the default filter on its own.)
  {
    vendor: LLM_VENDOR.CLAUDE, active: flag("CLAUDE_CODE_USE_VERTEX"),
    credentials: names(["GOOGLE_APPLICATION_CREDENTIALS"]), plumbing: ["CLOUD_ML_REGION"],
  },
  // Codex with a model provider from the user's own Codex config, such as Azure
  // OpenAI, whose key Codex reads from the variable the provider's `env_key` names:
  // https://github.com/openai/codex/blob/main/docs/config.md#model_providers
  {
    vendor: LLM_VENDOR.CODEX, active: (env) => codexProviderKey(env).length > 0,
    credentials: codexProviderKey, plumbing: [],
  },
  // Gemini CLI on Vertex AI, by Google Cloud API key (GOOGLE_API_KEY), service
  // account key file, or application default credentials, with project and location:
  // https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md
  {
    vendor: LLM_VENDOR.GOOGLE, active: flag("GOOGLE_GENAI_USE_VERTEXAI"),
    credentials: names(["GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]),
    plumbing: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
  },
];

/** What a vendor CLI needs from the environment in every mode. Names are exact, never globs. */
interface VendorEnvSpec {
  /** Variable a configured API key is written to; absent when the vendor takes no key. */
  keyEnv?: (config: LLMConfig) => string;
  /** Authentication names retained in addition to `keyEnv`. */
  authNames: readonly string[];
  /** The configured API key, if any. */
  configKey: (config: LLMConfig) => string | undefined;
}

/** A local model server needs no credentials; an unrecognised vendor gets none either. */
const NO_CREDENTIALS: VendorEnvSpec = { authNames: [], configKey: () => undefined };

const VENDOR_ENV: Record<LLMVendor, VendorEnvSpec> = {
  [LLM_VENDOR.CLAUDE]: {
    keyEnv: () => "ANTHROPIC_API_KEY",
    authNames: ["ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"],
    configKey: (config) => config.claude?.api_key,
  },
  [LLM_VENDOR.CODEX]: {
    keyEnv: () => "OPENAI_API_KEY",
    authNames: ["CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_HOME"],
    configKey: (config) => config.codex?.api_key,
  },
  [LLM_VENDOR.GOOGLE]: {
    // A custom apiKeyEnv is an exact name, so it cannot widen credential access.
    keyEnv: (config) => config.google?.apiKeyEnv ?? "GEMINI_API_KEY",
    authNames: [],
    configKey: (config) => config.google?.api_key,
  },
  [LLM_VENDOR.LOCAL]: NO_CREDENTIALS,
};

/**
 * Filter a vendor CLI's environment without exposing unrelated credentials.
 * `onStripped` receives names only, never values: once for the names removed,
 * and once more (kind `missing-credentials`) when a mode in `VENDOR_MODES` is
 * on but none of that mode's credential names reached the child.
 */
export function resolveVendorCliEnv(
  config: LLMConfig,
  envConfig?: EnvPolicyConfig,
  source: NodeJS.ProcessEnv = process.env,
  onStripped?: (names: string[], kind: EnvReportKind) => void,
): NodeJS.ProcessEnv {
  const vendor = config.vendor ?? DEFAULT_LLM_VENDOR;
  const policy = compileEnvPolicy(envConfig);
  const env = sanitizeChildEnv(source, policy);
  // config.vendor may come from unvalidated JSON.
  const known = isLLMVendor(vendor);
  const spec = known ? VENDOR_ENV[vendor] : NO_CREDENTIALS;
  const keyName = spec.keyEnv?.(config);
  // Keep a mode's names only while the child will use that mode.
  const activeModes = (known ? VENDOR_MODES.filter((mode) => mode.vendor === vendor && mode.active(env)) : [])
    .map((mode) => ({ credentials: mode.credentials(env), plumbing: mode.plumbing }));
  const authNames = [
    ...(keyName ? [keyName] : []),
    ...spec.authNames,
    ...activeModes.flatMap((mode) => [...mode.credentials, ...mode.plumbing]),
  ];
  const authSet = new Set(authNames.map((name) => name.toUpperCase()));
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && authSet.has(name.toUpperCase())) env[name] = value;
  }
  const apiKey = spec.configKey(config);
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
  if (stripped.length > 0) onStripped?.(stripped, "stripped");
  const present = new Set(Object.keys(env).map((name) => name.toUpperCase()));
  const missing = activeModes
    .filter((mode) => !mode.credentials.some((name) => present.has(name.toUpperCase())))
    .flatMap((mode) => mode.credentials);
  if (missing.length > 0) onStripped?.(missing, "missing-credentials");
  return env;
}
