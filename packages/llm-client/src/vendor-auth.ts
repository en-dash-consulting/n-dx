/**
 * Which credential a vendor gets: `llm.<vendor>.auth`.
 *
 * - `cli`  — the vendor CLI's own login. No API key is used or passed on.
 * - `api`  — an API key, from `llm.<vendor>.api_key`, then the vendor's
 *   environment variable, then the per-user credential store.
 * - `auto` (default) — the API only when a key is configured or exported. A
 *   key held only in the store never selects it, so storing a key never moves
 *   a project off its CLI login.
 *
 * Gemini has no CLI login: `auto` and `api` both mean the API, from any of the
 * three sources. `hench.provider` (which loop hench drives) stays a separate
 * setting; hench refuses an `api` loop that the auth setting contradicts.
 *
 * Nothing here prints or logs a credential value.
 *
 * @module llm-client/vendor-auth
 */

import {
  CREDENTIAL_ENV_VARS,
  hasStoredCredential,
  resolveCredential,
  type CredentialStoreOptions,
} from "./credential-store.js";
import { ClaudeClientError, type AuthMode, type VendorAuth } from "./types.js";
import { LLM_VENDOR, type LLMConfig } from "./llm-types.js";

/** Every value `llm.<vendor>.auth` accepts; google refuses `cli`. */
export const VENDOR_AUTH_VALUES: readonly VendorAuth[] = ["cli", "api", "auto"];

export const DEFAULT_VENDOR_AUTH: VendorAuth = "auto";

/** The vendors that take an API key. */
export type KeyedVendor = typeof LLM_VENDOR.CLAUDE | typeof LLM_VENDOR.CODEX | typeof LLM_VENDOR.GOOGLE;

export const KEYED_VENDORS: readonly KeyedVendor[] = [LLM_VENDOR.CLAUDE, LLM_VENDOR.CODEX, LLM_VENDOR.GOOGLE];

export function isKeyedVendor(vendor: unknown): vendor is KeyedVendor {
  return (KEYED_VENDORS as readonly unknown[]).includes(vendor);
}

/** Whether `vendor` has a CLI login `auto` can fall back to. */
export function hasVendorCliLogin(vendor: KeyedVendor): boolean {
  return vendor !== LLM_VENDOR.GOOGLE;
}

/** Where a vendor key came from. */
export type VendorKeySource = "config" | "env" | "file" | "helper";

export interface ResolvedVendorKey {
  value: string;
  source: VendorKeySource;
}

export interface VendorKeyOptions
  extends Pick<CredentialStoreOptions, "env" | "ndxHome" | "home" | "warn" | "runHelpers" | "helperExec"> {
  /** The variable read in place of the vendor's default (hench's `apiKeyEnv`). */
  apiKeyEnv?: string;
}

/** The environment variable that carries `vendor`'s key. */
export function vendorKeyEnv(vendor: KeyedVendor, config: LLMConfig, apiKeyEnv?: string): string {
  if (apiKeyEnv) return apiKeyEnv;
  if (vendor === LLM_VENDOR.GOOGLE && config.google?.apiKeyEnv) return config.google.apiKeyEnv;
  return CREDENTIAL_ENV_VARS[vendor];
}

/** `llm.<vendor>.auth`, or the default when unset (or `cli` on google). */
export function vendorAuthSetting(vendor: KeyedVendor, config: LLMConfig): VendorAuth {
  const auth = config[vendor]?.auth;
  if (auth === undefined || (auth === "cli" && !hasVendorCliLogin(vendor))) return DEFAULT_VENDOR_AUTH;
  return auth;
}

function storeOptions(vendor: KeyedVendor, config: LLMConfig, options: VendorKeyOptions): CredentialStoreOptions {
  return {
    ...(options.env ? { env: options.env } : {}),
    ...(options.ndxHome ? { ndxHome: options.ndxHome } : {}),
    ...(options.home ? { home: options.home } : {}),
    ...(options.warn ? { warn: options.warn } : {}),
    ...(options.runHelpers !== undefined ? { runHelpers: options.runHelpers } : {}),
    ...(options.helperExec ? { helperExec: options.helperExec } : {}),
    envVar: vendorKeyEnv(vendor, config, options.apiKeyEnv),
  };
}

/** `vendor`'s key from `llm.<vendor>.api_key` or its environment variable: never the store. */
function declaredVendorKey(vendor: KeyedVendor, config: LLMConfig, options: VendorKeyOptions): ResolvedVendorKey | undefined {
  const configured = config[vendor]?.api_key;
  if (configured) return { value: configured, source: "config" };
  const exported = (options.env ?? process.env)[vendorKeyEnv(vendor, config, options.apiKeyEnv)]?.trim();
  return exported ? { value: exported, source: "env" } : undefined;
}

/**
 * `vendor`'s API key: `llm.<vendor>.api_key`, then its environment variable,
 * then the credential store. Undefined when none holds one. Whether the key is
 * used is {@link resolveVendorAuth}'s decision, not this function's.
 */
export function resolveVendorKey(
  vendor: KeyedVendor,
  config: LLMConfig,
  options: VendorKeyOptions = {},
): ResolvedVendorKey | undefined {
  const configured = config[vendor]?.api_key;
  if (configured) return { value: configured, source: "config" };
  return resolveCredential(vendor, storeOptions(vendor, config, options));
}

export interface VendorAuthDecision {
  vendor: KeyedVendor;
  /** The setting in force. */
  auth: VendorAuth;
  /** Where `auth` came from: `llm.<vendor>.auth`, or `built-in`. */
  authSource: string;
  /** The credential the vendor gets: its API, or its CLI login. */
  mode: AuthMode;
  /** The key `mode: "api"` uses; undefined for the CLI, or when no key resolves. */
  key?: ResolvedVendorKey;
  /** Whether the credential store holds a key for this vendor, used or not. */
  storedKeyHeld: boolean;
  /**
   * Why a caller that must use the API (an API provider, hench's API loop)
   * cannot: `auth` is `cli` ({@link cliAuthConflictError}), or no key it may
   * use resolves ({@link missingVendorKeyError}). Undefined when `key` is usable.
   */
  apiRefusal?: ClaudeClientError;
}

/**
 * The credential `vendor` gets under `config`. In `api` mode `key` may still be
 * undefined: the caller refuses with {@link missingVendorKeyError}.
 */
export function resolveVendorAuth(
  vendor: KeyedVendor,
  config: LLMConfig,
  options: VendorKeyOptions = {},
): VendorAuthDecision {
  const auth = vendorAuthSetting(vendor, config);
  const authSource = config[vendor]?.auth === auth ? `llm.${vendor}.auth` : "built-in";
  // Held, not resolved: a helper entry runs only when its key is used.
  const storedKeyHeld = hasStoredCredential(vendor, storeOptions(vendor, config, options));
  const base = { vendor, auth, authSource, storedKeyHeld };
  if (auth === "cli") return { ...base, mode: "cli", apiRefusal: cliAuthConflictError(vendor, `the ${vendor} API`) };

  const missing = (): ClaudeClientError => missingVendorKeyError(vendor, config, options.apiKeyEnv);
  if (auth === "api" || !hasVendorCliLogin(vendor)) {
    const key = resolveVendorKey(vendor, config, options);
    return key ? { ...base, mode: "api", key } : { ...base, mode: "api", apiRefusal: missing() };
  }
  // auto: only a key someone configured or exported selects the API, so the
  // store (and any helper) is not consulted.
  const key = declaredVendorKey(vendor, config, options);
  if (key) return { ...base, mode: "api", key };
  return { ...base, mode: "cli", apiRefusal: missing() };
}

/** The key an API call for `vendor` sends, under `llm.<vendor>.auth`; undefined when none may be used. */
export function resolveVendorApiKey(
  vendor: KeyedVendor,
  config: LLMConfig,
  options: VendorKeyOptions = {},
): ResolvedVendorKey | undefined {
  const decision = resolveVendorAuth(vendor, config, options);
  return decision.mode === "api" ? decision.key : undefined;
}

/**
 * The key an API provider for `vendor` sends. Throws when `llm.<vendor>.auth`
 * is `cli` (the API is not this project's credential) or when no key may be
 * used ({@link missingVendorKeyError}).
 */
export function requireVendorApiKey(
  vendor: KeyedVendor,
  config: LLMConfig,
  options: VendorKeyOptions = {},
): ResolvedVendorKey {
  const decision = resolveVendorAuth(vendor, config, options);
  if (decision.apiRefusal || !decision.key) throw decision.apiRefusal ?? missingVendorKeyError(vendor, config, options.apiKeyEnv);
  return decision.key;
}

/** The refusal when `llm.<vendor>.auth` is `cli` but `what` needs the API. */
export function cliAuthConflictError(vendor: KeyedVendor, what: string, hint = ""): ClaudeClientError {
  return new ClaudeClientError(
    `llm.${vendor}.auth is "cli" (the ${vendor} CLI login), but ${what} needs an API key. ` +
      `Set 'ndx config llm.${vendor}.auth api' to use an API key${hint}.`,
    "auth",
    false,
  );
}

const VENDOR_LABEL: Record<KeyedVendor, string> = { claude: "Claude", codex: "OpenAI (Codex)", google: "Google Gemini" };

/**
 * The refusal when `vendor` needs an API key and has none it may use: names
 * the store command and the auth setting. Never carries a value.
 */
export function missingVendorKeyError(
  vendor: KeyedVendor,
  config: LLMConfig,
  apiKeyEnv?: string,
): ClaudeClientError {
  const envVar = vendorKeyEnv(vendor, config, apiKeyEnv);
  const label = VENDOR_LABEL[vendor];
  const message = hasVendorCliLogin(vendor)
    ? `The ${label} API needs a key and none may be used. ` +
      `Store one with 'ndx config credentials.${vendor}' and set 'ndx config llm.${vendor}.auth api', ` +
      `or export ${envVar} (llm.${vendor}.auth "auto" uses a configured or exported key, ` +
      `never one held only in the credential store). ` +
      `To use the ${vendor} CLI login instead, set 'ndx config llm.${vendor}.auth cli'.`
    : `The ${label} API needs a key and none is set. ` +
      `Store one with 'ndx config credentials.${vendor}', or export ${envVar} ` +
      `(llm.${vendor}.auth is "api" or "auto": ${vendor} has no CLI login).`;
  return new ClaudeClientError(message, "auth", false);
}

/**
 * One line describing `decision`, never the value: `claude: cli (store key held, unused)`.
 * `helpersRun: false` says the decision was made with helpers not run, so a
 * key held only behind a helper reads as not run rather than missing.
 */
export function describeVendorAuth(decision: VendorAuthDecision, envVar: string, helpersRun = true): string {
  const parts: string[] = [];
  if (decision.authSource !== "built-in") parts.push(`llm.${decision.vendor}.auth ${decision.auth}`);
  const key = decision.mode === "api" ? decision.key : undefined;
  const fromStore = key?.source === "file" || key?.source === "helper";
  if (key) {
    parts.push(
      key.source === "config"
        ? `key from llm.${decision.vendor}.api_key`
        : key.source === "env"
          ? `key from ${envVar}`
          : key.source === "helper"
            ? "key from the credential store's helper"
            : "key from the credential store",
    );
  } else if (decision.mode === "api" && decision.storedKeyHeld) {
    // A held file key always resolves, so this is a helper.
    parts.push(helpersRun ? "the stored key's helper failed" : "key from the credential store's helper, not run (--check runs it)");
  } else if (decision.mode === "api") {
    parts.push(`no key: store one with ndx config credentials.${decision.vendor}`);
  }
  if (decision.storedKeyHeld && !fromStore && !(decision.mode === "api" && !key)) parts.push("store key held, unused");
  return `${decision.vendor}: ${decision.mode}${parts.length > 0 ? ` (${parts.join("; ")})` : ""}`;
}
