/** Executor MCP routing: admit a bounded native snapshot, then ignore mutable
 * user/project config during exec. A table override alone merges foreign names. */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative } from "node:path";
import { projectCodexExecConfig } from "./codex-exec-config.js";
import { readCodexEffectiveConfig } from "../../prd/llm-gateway.js";
import { buildAgentMcpServers, resolveLauncherCli, LAUNCHER_REJECTION_DETAIL } from "../../process/agent-mcp-config.js";

function refusal(detail: string): Error {
  return new Error(`Codex MCP binding refused: ${detail}. Restart n-dx work from the assigned checkout with its original n-dx launcher; repair the named configuration before retrying. No executor was started.`);
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

/** Every launch inspects policy through the original home, without loading a
 * model or evaluating helpers. Only admitted values cross into ignored exec.
 * HOME/CODEX_HOME/auth stay unchanged. Unsupported configurations refuse. */
export async function bindCodexMcp(options: CodexMcpBindingOptions): Promise<string[]> {
  const binding = readExecutorMcpBinding(options.path, options.cwd);
  let snapshot;
  try {
    snapshot = await readCodexEffectiveConfig({ ...options, includeLayersAndRequirements: true });
  } catch {
    options.signal?.throwIfAborted();
    throw refusal("the selected CLI cannot verify config/read layers and configRequirements/read via app-server --strict-config");
  }
  options.signal?.throwIfAborted();
  if (!snapshot) throw refusal("configuration verification was cancelled");
  const flags = await projectCodexExecConfig(snapshot, options.env);
  options.signal?.throwIfAborted();
  const set = (key: string, value: unknown) => flags.push("-c", `${key}=${JSON.stringify(value)}`);
  set("features.apps", false);
  set("features.plugins", false);
  set("features.shell_snapshot", false);
  for (const [name, server] of Object.entries(binding.servers)) {
    const prefix = `mcp_servers.${name}`;
    set(`${prefix}.command`, server.command);
    set(`${prefix}.args`, server.args);
    set(`${prefix}.cwd`, binding.root);
    set(`${prefix}.enabled`, options.disabled !== true);
    set(`${prefix}.required`, true);
  }
  // Drop original config selectors after their effective values were admitted.
  // Keeping them would reintroduce profiles or transport/env fields on Rex.
  const exec = options.args.indexOf("exec");
  if (exec < 0) throw refusal("missing exec command");
  if (exec !== 0) throw refusal("wrapper prefixes cannot be verified for isolated exec");
  const args = ["exec"];
  for (let i = 1; i < options.args.length; i++) {
    const arg = options.args[i];
    if (arg === "--strict-config") continue; // Emitted once below for every launch.
    if (["-p", "--profile"].includes(arg) || /^(--profile=|-p.)/.test(arg)) throw refusal("native profile selection is not verified for isolated exec");
    if (["-c", "--config", "--enable", "--disable"].includes(arg)) { i++; continue; }
    if (/^(--config=|--enable=|--disable=|-c.)/.test(arg)) continue;
    args.push(arg);
  }
  args.splice(args.at(-1) === "-" ? args.length - 1 : args.length, 0, "--ignore-user-config", "--strict-config", ...flags);
  // The file is still checked after the asynchronous read. Exec consumes only
  // the in-memory commands above, never the mutable run-owned document.
  readExecutorMcpBinding(options.path, options.cwd);
  return args;
}
