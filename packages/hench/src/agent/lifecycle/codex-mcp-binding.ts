/** Executor MCP routing. Keep native auth, profiles and organizational policy;
 * override only MCP registrations, then verify the effective native result.
 * A table override MERGES in Codex, so it cannot by itself exclude user servers.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative } from "node:path";
import { readCodexEffectiveConfig } from "../../prd/llm-gateway.js";
import { buildAgentMcpServers, resolveLauncherCli, LAUNCHER_REJECTION_DETAIL } from "../../process/agent-mcp-config.js";

function refusal(detail: string): Error {
  return new Error(`Codex MCP binding refused: ${detail}. Restart n-dx work from the assigned checkout with its original n-dx launcher; repair the named configuration before retrying. No executor was started.`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Re-read on EVERY launch, including retries. Do not regenerate a lost or
 * modified file here: that would hide a broken continuation binding.
 */
export function readExecutorMcpBinding(path: string, cwd: string) {
  const launcher = resolveLauncherCli();
  if (!launcher.usable) throw refusal(LAUNCHER_REJECTION_DETAIL[launcher.reason]);
  let root: string;
  let value: unknown;
  try {
    root = realpathSync(cwd);
    const info = lstatSync(path);
    const location = relative(root, realpathSync(path));
    if (isAbsolute(location) || location === ".." || location.startsWith("../") || location.startsWith("..\\") ||
        !info.isFile() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o022) !== 0)) {
      throw refusal(`unsafe configuration file ${path}`);
    }
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw refusal(`missing, unreadable, malformed or unsafe configuration file ${path}`);
  }
  const expected = buildAgentMcpServers({ cliPath: launcher.cliPath, projectDir: root });
  if (!isDeepStrictEqual(value, expected)) throw refusal(`configuration ${path} does not bind only Rex and SourceVision to ${root}`);
  return { root, servers: expected.mcpServers };
}

export interface CodexMcpBindingOptions {
  path: string;
  binary: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Orientation never exposes write-capable MCP tools. */
  disabled?: boolean;
}

/** Returns exec argv with a verified binding; never changes CODEX_HOME, auth,
 * trust, native provider/model selection or any config file. Unsupported
 * native config/read and unaddressable server names refuse without fallback.
 */
export async function bindCodexMcp(options: CodexMcpBindingOptions): Promise<string[]> {
  const binding = readExecutorMcpBinding(options.path, options.cwd);
  const read = async (args: readonly string[]) => {
    let config;
    try { config = await readCodexEffectiveConfig({ ...options, args }); }
    catch { throw refusal("the selected CLI cannot verify effective MCP configuration via app-server config/read --strict-config"); }
    options.signal?.throwIfAborted();
    return config;
  };
  const initial = await read(options.args);
  if (!initial) throw refusal("configuration verification was cancelled");
  const inherited = record(initial.mcp_servers) ?? {};
  const flags: string[] = [];
  const set = (key: string, value: unknown) => flags.push("-c", `${key}=${JSON.stringify(value)}`);
  set("features.apps", false);
  // Plugin-provided MCP servers are loaded separately from mcp_servers.
  set("features.plugins", false);
  for (const name of Object.keys(inherited)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw refusal("an MCP registration has a name that cannot be safely overridden");
    if (!Object.hasOwn(binding.servers, name)) set(`mcp_servers.${name}.enabled`, false);
  }
  for (const [name, server] of Object.entries(binding.servers)) {
    const prefix = `mcp_servers.${name}`;
    set(`${prefix}.command`, server.command);
    set(`${prefix}.args`, server.args);
    set(`${prefix}.cwd`, binding.root);
    set(`${prefix}.enabled`, options.disabled !== true);
    set(`${prefix}.required`, true);
  }
  // Config flags are global to exec/resume/fork, before the stdin positional.
  const args = [...options.args];
  const exec = args.indexOf("exec");
  if (exec < 0) throw refusal("missing exec command");
  args.splice(args.at(-1) === "-" ? args.length - 1 : args.length, 0, ...flags);
  const effective = await read(args);
  const servers = record(effective?.mcp_servers);
  if (!servers) throw refusal("native configuration omitted the required MCP servers");
  if (record(effective?.features)?.apps !== false) throw refusal("native configuration did not disable unrelated app tools");
  if (record(effective?.features)?.plugins !== false) throw refusal("native configuration did not disable plugin tools");
  for (const [name, value] of Object.entries(servers)) {
    const server = record(value);
    if (!Object.hasOwn(binding.servers, name) && server?.enabled !== false) throw refusal("native configuration retained an unrelated MCP server");
  }
  for (const [name, expected] of Object.entries(binding.servers)) {
    const server = record(servers[name]);
    if (!server || server.command !== expected.command || !isDeepStrictEqual(server.args, expected.args) ||
        server.cwd !== binding.root || server.enabled !== (options.disabled !== true) || server.required !== true ||
        server.url != null || (server.env != null && Object.keys(record(server.env) ?? { unsafe: true }).length > 0) ||
        (server.env_vars != null && !isDeepStrictEqual(server.env_vars, [])) ||
        (server.environment_id != null && server.environment_id !== "local")) {
      throw refusal(`native ${name} registration is unsafe or bound to another workspace`);
    }
  }
  // Catch replacement during either native read, before the executor spawn.
  readExecutorMcpBinding(options.path, options.cwd);
  return args;
}
