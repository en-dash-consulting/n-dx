/**
 * What a reader of the tracked project config ignores while the repository
 * is not trusted.
 *
 * `.n-dx.json` is usually committed, so a clone or a checked-out pull request
 * can set the keys that choose *which binary runs* (`llm.<vendor>.cli_path`,
 * the legacy `claude.cli_path`), *where API calls go* (`llm.<vendor>.api_endpoint`,
 * `llm.local.host`/`port` and the verifier's), and *which environment
 * variable is sent as the key* (`llm.<vendor>.apiKeyEnv`). Those keys are in
 * the repository trust digest (`repo-trust.ts`), and while the user has not
 * accepted the digest the loaders drop them from the tracked file before the
 * merge — so a value in the user's own git-ignored `.n-dx.local.json`, which
 * is merged afterwards, still applies.
 *
 * The same keys are what `ndx config` already writes to the local file only.
 */

const VENDOR_BLOCKS = ["claude", "codex", "google", "local"] as const;

/** Keys dropped from every `llm.<vendor>` block and the legacy `claude` block. */
const BINARY_AND_ENDPOINT_KEYS = ["cli_path", "api_endpoint", "apiKeyEnv"] as const;

/** Keys dropped from `llm.local` and `llm.local.verifier`. */
const HOST_KEYS = ["host", "port"] as const;

export interface TrackedConfigClamp {
  /** The root with the execution-relevant keys removed; the input is not mutated. */
  root: Record<string, unknown>;
  /** The dotted keys that were present and dropped, in document order. */
  stripped: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function dropKeys(block: Record<string, unknown>, keys: readonly string[], prefix: string, stripped: string[]): Record<string, unknown> {
  const out = { ...block };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      stripped.push(`${prefix}.${key}`);
      delete out[key];
    }
  }
  return out;
}

/**
 * Remove the binary, endpoint and key-variable choices from a parsed tracked
 * project config. Everything else — vendor, models, tiers, routes — is the
 * repository's to set and stays.
 */
export function stripTrackedExecutionConfig(root: Record<string, unknown>): TrackedConfigClamp {
  const stripped: string[] = [];
  const out: Record<string, unknown> = { ...root };

  const legacyClaude = asRecord(out.claude);
  if (legacyClaude) out.claude = dropKeys(legacyClaude, BINARY_AND_ENDPOINT_KEYS, "claude", stripped);

  const llm = asRecord(out.llm);
  if (llm) {
    const nextLlm: Record<string, unknown> = { ...llm };
    for (const vendor of VENDOR_BLOCKS) {
      const block = asRecord(nextLlm[vendor]);
      if (!block) continue;
      let next = dropKeys(block, BINARY_AND_ENDPOINT_KEYS, `llm.${vendor}`, stripped);
      if (vendor === "local") {
        next = dropKeys(next, HOST_KEYS, "llm.local", stripped);
        const verifier = asRecord(next.verifier);
        if (verifier) next.verifier = dropKeys(verifier, HOST_KEYS, "llm.local.verifier", stripped);
      }
      nextLlm[vendor] = next;
    }
    out.llm = nextLlm;
  }

  return { root: out, stripped };
}
