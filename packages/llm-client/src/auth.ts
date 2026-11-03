/**
 * Authentication detection and validation.
 *
 * Provides utilities to detect available authentication methods (CLI / API key),
 * validate credentials before use, and produce human-readable diagnostics when
 * authentication is misconfigured.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AuthMode, ClaudeClientOptions, VendorAuth } from "./types.js";
import { ClaudeClientError } from "./types.js";
import { DEFAULT_CLAUDE_MODEL, resolveApiKey, resolveCliPath } from "./config.js";
import { LLM_VENDOR } from "./provider-interface.js";
import { resolveVendorAuth, resolveVendorKey, type VendorKeySource } from "./vendor-auth.js";
import { exec } from "./exec.js";

// ── CLI availability ─────────────────────────────────────────────────────────

/**
 * Check whether the Claude Code CLI binary is reachable.
 *
 * Runs `<binary> --version` and resolves `true` if the command exits
 * successfully (exit code 0), `false` otherwise (not found, permission
 * error, crash, etc.).
 */
export async function detectCliAvailability(
  options: ClaudeClientOptions,
): Promise<boolean> {
  const binary = resolveCliPath(options.claudeConfig);
  const result = await exec(binary, ["--version"], { cwd: process.cwd(), timeout: 5000 });
  return result.exitCode === 0;
}

// ── API key validation ───────────────────────────────────────────────────────

/**
 * Validate that the resolved API key is accepted by the Anthropic API.
 *
 * Makes a minimal `messages.create` call with 1 max_tokens. The call is
 * expected to succeed (or fail with a non-auth error such as rate-limit),
 * confirming the key is valid.
 *
 * @returns `true` if the key is valid, `false` if authentication fails
 *   (401/403).
 * @throws {ClaudeClientError} with reason "auth" when no API key is
 *   available at all (not configured and not in env).
 */
export async function validateApiKey(
  options: ClaudeClientOptions,
): Promise<boolean> {
  const apiKeyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey = resolveApiKey(options.claudeConfig, apiKeyEnv);

  if (!apiKey) {
    throw new ClaudeClientError(
      `API key not found. Store one with 'ndx config credentials.claude' or export ${apiKeyEnv}.`,
      "auth",
      false,
    );
  }

  const clientOpts: Record<string, unknown> = { apiKey };
  if (options.claudeConfig.api_endpoint) {
    clientOpts.baseURL = options.claudeConfig.api_endpoint;
  }

  const client = new Anthropic(
    clientOpts as ConstructorParameters<typeof Anthropic>[0],
  );

  try {
    await client.messages.create({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      return false;
    }
    // Any other error (rate-limit, network, etc.) means the key itself is
    // structurally valid — the failure is unrelated to authentication.
    return true;
  }
}

// ── Auth detection (enhanced) ────────────────────────────────────────────────

/**
 * Result of the async authentication detection.
 */
export interface AuthDetectionResult {
  /** The recommended authentication mode. */
  mode: AuthMode;
  /** Whether the API key was found in configuration. */
  apiKeyAvailable: boolean;
  /** Whether the Claude Code CLI binary was found on PATH / configured path. */
  cliAvailable: boolean;
}

/**
 * Detect the best available authentication method by actually probing the
 * environment (checking the CLI binary and API key availability).
 *
 * Unlike the synchronous `detectAuthMode()` in create-client.ts which only
 * checks for an API key, this function also verifies CLI availability so the
 * caller gets a complete picture.
 *
 * Priority:
 * 1. `llm.claude.auth` selects the API and a key it may use resolves → "api"
 *    (`auto` takes a configured or exported key, never a stored one)
 * 2. CLI binary reachable → "cli"
 * 3. Neither available → throws with a helpful error message
 *
 * @throws {ClaudeClientError} with reason "auth" when neither method is
 *   available.
 */
export async function detectAvailableAuth(
  options: ClaudeClientOptions,
): Promise<AuthDetectionResult> {
  const apiKeyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const decision = resolveVendorAuth(LLM_VENDOR.CLAUDE, { claude: options.claudeConfig }, { apiKeyEnv });
  const apiKeyAvailable = decision.mode === "api" && decision.key !== undefined;

  if (apiKeyAvailable) {
    // API key takes priority — don't even check CLI
    return { mode: "api", apiKeyAvailable: true, cliAvailable: false };
  }

  // No API key → check if CLI is available as fallback
  const cliAvailable = await detectCliAvailability(options);

  if (cliAvailable) {
    return { mode: "cli", apiKeyAvailable: false, cliAvailable: true };
  }

  // Neither method is available
  throw new ClaudeClientError(
    "No authentication method available. Either:\n" +
      "  - Install the Claude Code CLI and log in: npm install -g @anthropic-ai/claude-code, then claude login\n" +
      `  - Use an API key: export ${apiKeyEnv}, or store one with 'ndx config credentials.claude'. Storing a key does not switch modes; 'ndx config llm.claude.auth api' does.`,
    "auth",
    false,
  );
}

// ── Diagnostic summary ───────────────────────────────────────────────────────

/**
 * Diagnostic details about the current authentication setup.
 */
export interface AuthDiagnostics {
  /** `llm.claude.auth` in force. */
  mode: VendorAuth;
  /** Where a key resolves from (config, env, the credential store), whether or not `mode` uses it. */
  keySource: VendorKeySource | "none";
  /** The API key source, if available. Same as `keySource`. */
  apiKeySource: VendorKeySource | "none";
  /** Whether the resolved API key passed validation (undefined if skipped). */
  apiKeyValid?: boolean;
  /** Whether the CLI binary was found. */
  cliAvailable: boolean;
  /** The recommended mode based on the diagnostics. */
  recommendedMode: AuthMode | "none";
  /** Human-readable summary lines for display. */
  messages: string[];
}

/**
 * Run a full diagnostic check on authentication configuration.
 *
 * This is useful for `ndx config` / status commands to tell the user
 * exactly what is and isn't working.
 *
 * When `validateKey` is true (default: false), the function makes a real
 * API call to verify the key is accepted. This costs a tiny number of
 * tokens but confirms end-to-end auth.
 */
export async function diagnoseAuth(
  options: ClaudeClientOptions & { validateKey?: boolean },
): Promise<AuthDiagnostics> {
  const apiKeyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const messages: string[] = [];

  // ── Auth setting and key ──
  const decision = resolveVendorAuth(LLM_VENDOR.CLAUDE, { claude: options.claudeConfig }, { apiKeyEnv });
  // The key the selected mode would send; a held key it ignores is not one.
  const usableKey = decision.mode === "api" && decision.key !== undefined;
  // A helper runs only when the mode uses its key (then it already ran, cached).
  const resolvedKey = resolveVendorKey(LLM_VENDOR.CLAUDE, { claude: options.claudeConfig }, {
    apiKeyEnv,
    runHelpers: decision.mode === "api",
  });
  const keySource: AuthDiagnostics["keySource"] = resolvedKey?.source ?? "none";
  let apiKeyValid: boolean | undefined;

  messages.push(`Auth: llm.claude.auth ${decision.auth} → ${decision.mode}`);
  if (keySource === "config") {
    messages.push(`API key: found in a project config file (claude.api_key); move it to the credential store with 'ndx config credentials --import' (.n-dx.local.json) or 'ndx config credentials.claude' (.n-dx.json)`);
  } else if (keySource === "env") {
    messages.push(`API key: found in environment (${apiKeyEnv})`);
  } else if (keySource === "file") {
    messages.push(
      usableKey ? "API key: found in the credential store" : "API key: held in the credential store, unused",
    );
  } else if (keySource === "helper") {
    messages.push("API key: from the credential store's helper");
  } else if (decision.storedKeyHeld) {
    // Only a helper entry can be held yet unresolved: not run, or it failed.
    messages.push(
      decision.mode === "api"
        ? "API key: the credential store's helper failed"
        : "API key: held in the credential store (helper), unused",
    );
  } else {
    messages.push("API key: not configured");
  }

  if (usableKey && options.validateKey) {
    try {
      apiKeyValid = await validateApiKey(options);
      messages.push(apiKeyValid ? "API key: validated successfully" : "API key: rejected by API (invalid or expired)");
    } catch {
      apiKeyValid = false;
      messages.push("API key: validation failed");
    }
  }

  // ── CLI ──
  const cliAvailable = await detectCliAvailability(options);
  const cliPath = resolveCliPath(options.claudeConfig);
  if (cliAvailable) {
    messages.push(`CLI: available (${cliPath})`);
  } else {
    messages.push(`CLI: not found (looked for: ${cliPath})`);
  }

  // ── Recommendation ──
  let recommendedMode: AuthDiagnostics["recommendedMode"] = "none";
  if (usableKey && apiKeyValid !== false) {
    recommendedMode = "api";
  } else if (decision.auth !== "api" && cliAvailable) {
    recommendedMode = "cli";
  }

  if (recommendedMode === "none") {
    messages.push(
      decision.auth === "api"
        ? "No authentication method available: llm.claude.auth is api and no usable API key resolves."
        : "No authentication method available. Install the Claude Code CLI and run 'claude login', or store a key with 'ndx config credentials.claude' (then 'ndx config llm.claude.auth api' to use it).",
    );
  } else {
    messages.push(`Recommended mode: ${recommendedMode}`);
  }

  return {
    mode: decision.auth,
    keySource,
    apiKeySource: keySource,
    apiKeyValid,
    cliAvailable,
    recommendedMode,
    messages,
  };
}
