/**
 * The credential name the operator's own Codex config tells Codex to read.
 *
 * Codex picks its model provider from `config.toml` in `CODEX_HOME`
 * (default `~/.codex`): top-level `model_provider`, or the one the selected
 * `profile` sets, and reads that provider's API key from the variable its
 * `env_key` names (for Azure OpenAI, typically `AZURE_OPENAI_API_KEY`).
 * https://github.com/openai/codex/blob/main/docs/config.md#model_providers
 *
 * Only the user's home config is read. A repository-local `.codex/config.toml`
 * or the repository's n-dx config could name any variable, and naming is all
 * it would take to pull that credential into the child.
 *
 * llm-client takes no dependencies, so this reads the four keys it needs from
 * a TOML subset: `[table]` headers with bare or quoted segments, and
 * single-line string values. Anything else (inline tables, dotted keys,
 * multi-line strings) is skipped, which leaves the mode off and the name
 * stripped, as it was before the mode existed.
 *
 * @module llm-client/codex-user-config
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** An exact environment variable name; globs and anything else are rejected. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Remove a `#` comment that sits outside any string. */
function stripComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === "\"" && ch === "\\") i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Split a dotted key path, unquoting each segment. Undefined when malformed. */
function keyPath(text: string): string[] | undefined {
  const segments = text.match(/\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*(?:\.|$)/g);
  if (!segments || segments.join("") !== text) return undefined;
  return segments.map((segment) => segment.trim().replace(/\.$/, "").trim().replace(/^(["'])(.*)\1$/, "$2"));
}

function stringValue(text: string): string | undefined {
  const match = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(text);
  return match ? (match[1] ?? match[2]) : undefined;
}

/** Map of `JSON.stringify(path)` to single-line string value. */
export function parseCodexConfigStrings(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let table: string[] | undefined = [];
  let closeMultiline: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (closeMultiline) {
      if (raw.includes(closeMultiline)) closeMultiline = undefined;
      continue;
    }
    const line = stripComment(raw).trim();
    if (!line) continue;
    if (line.startsWith("[[")) {
      table = undefined; // array of tables: none of the keys read here live in one
      continue;
    }
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      table = keyPath(header[1]);
      continue;
    }
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!pair) continue;
    const opener = /^("""|''')/.exec(pair[2]);
    if (opener && !pair[2].slice(3).includes(opener[1])) {
      closeMultiline = opener[1];
      continue;
    }
    const key = keyPath(pair[1]);
    const value = stringValue(pair[2]);
    if (table && key && value !== undefined) values.set(JSON.stringify([...table, ...key]), value);
  }
  return values;
}

/**
 * `env_key` of the model provider the user's Codex config selects, or
 * undefined when the config is absent, selects no provider table, or names
 * something that is not an exact variable name.
 */
export function codexUserEnvKey(env: NodeJS.ProcessEnv, home: string = homedir()): string | undefined {
  const dir = env.CODEX_HOME || join(home, ".codex");
  let text: string;
  try {
    text = readFileSync(join(dir, "config.toml"), "utf8");
  } catch (error) {
    // No config is the ordinary case: Codex then uses its built-in OpenAI provider.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  const values = parseCodexConfigStrings(text);
  const get = (...path: string[]) => values.get(JSON.stringify(path));
  const profile = get("profile");
  const provider = (profile !== undefined ? get("profiles", profile, "model_provider") : undefined) ?? get("model_provider");
  if (provider === undefined) return undefined;
  const envKey = get("model_providers", provider, "env_key");
  return envKey !== undefined && ENV_NAME.test(envKey) ? envKey : undefined;
}
