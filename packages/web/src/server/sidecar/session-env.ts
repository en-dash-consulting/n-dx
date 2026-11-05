/**
 * The environment inputs a Sidecar vendor session runs with.
 *
 * A Sidecar session is a vendor CLI the dashboard spawns, so it gets what
 * hench's vendor CLIs get: the parent environment filtered by the project's
 * `hench.guard.env` policy, keeping only the active vendor's authentication.
 * `startVendorSession` does the filtering when handed a policy and no env;
 * this module only finds the policy and the LLM config.
 *
 * The policy is `.hench/config.json`'s `guard.env` with the `hench` section of
 * `.n-dx.json` / `.n-dx.local.json` merged over it — the merge hench's own
 * loader applies. While the checkout is untrusted, a repository-supplied
 * `allow` list is dropped, as `ndx`'s cross-vendor reviewer does
 * (`loadVendorCliEnv` in `packages/core/config.js`): a cloned repository must
 * not be able to hand its own vendor session the user's credentials.
 */

import { evaluateRepoTrust, mergeWithOverrides, parseLLMConfig } from "@n-dx/llm-client";
import type { EnvPolicyConfig, LLMConfig } from "@n-dx/llm-client";
import { readConfigSnapshot } from "../effective-agent-config.js";

export interface SidecarSessionEnv {
  envPolicy?: EnvPolicyConfig;
  llmConfig: LLMConfig;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : undefined;
}

/** Read the project's env policy and LLM config for a Sidecar session in `projectDir`. */
export function resolveSidecarSessionEnv(projectDir: string): SidecarSessionEnv {
  const snapshot = readConfigSnapshot(projectDir);
  const hench = mergeWithOverrides(snapshot.hench, asRecord(snapshot.ndx["hench"]));
  const env = asRecord(asRecord(hench["guard"])["env"]);
  const deny = asStrings(env["deny"]);
  let allow = asStrings(env["allow"]);
  if (allow?.length && evaluateRepoTrust(projectDir).restricted) allow = undefined;
  const envPolicy = deny || allow ? { ...(deny && { deny }), ...(allow && { allow }) } : undefined;
  return { envPolicy, llmConfig: parseLLMConfig(snapshot.ndx) };
}
