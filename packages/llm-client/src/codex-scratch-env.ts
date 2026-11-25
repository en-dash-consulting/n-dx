/** Verify the selected native CLI's merged config before starting model work.
 * config/read resolves user, project and CLI layers; reading a single TOML file
 * would miss filters. No thread, model request or command/exec is sent here.
 */
import { StringDecoder } from "node:string_decoder";
import { diagnoseCliInvocation, diagnoseCliNotFound, spawnCli } from "./exec.js";
import { terminateProcessTree } from "./process-tree.js";
import { ClaudeClientError } from "./types.js";

interface ScratchEnvironmentOptions {
  binary: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  scratchDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Return { config, layers, requirements } after the separate requirements RPC.
   * Missing metadata is an error, never evidence of an unmanaged installation. */
  includeLayersAndRequirements?: boolean;
}

const TEMP_NAMES = ["TMPDIR", "TMP", "TEMP"];
const UNVERIFIED = "Cannot verify Codex private temp environment before execution. " +
  "The selected CLI must support app-server config/read with --strict-config; update llm.codex.cli_path or the CLI and retry. No model work was started.";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function checkConfig(value: unknown, scratchDir: string): void {
  const config = record(value);
  if (config?.profile != null) {
    throw new Error("Cannot verify Codex private temp with a legacy native profile selector. Use a CLI with effective profile config/read support and select the profile with --profile.");
  }
  const policy = record(config?.shell_environment_policy);
  const set = record(policy?.set);
  // Requiring our exact overrides in the response also detects older clients
  // that omit this config surface. Unknown ordered-filter dialects fail closed.
  if (!policy || !set || policy.filters != null || TEMP_NAMES.some(name => set[name] !== scratchDir)) {
    throw new Error(UNVERIFIED);
  }
  const include = policy.include_only;
  if (include != null && (!Array.isArray(include) || include.some(pattern => typeof pattern !== "string"))) {
    throw new Error(UNVERIFIED);
  }
  // Conservative admission: no attempt to reproduce the native glob dialect.
  // Literal names (or an existing unrestricted '*') prove all three survive.
  if (Array.isArray(include) && include.length && !include.includes("*") && TEMP_NAMES.some(name => !include.includes(name))) {
    throw new Error("Codex shell_environment_policy.include_only does not explicitly retain TMPDIR, TMP and TEMP. " +
      "Add these three names to that native allowlist, preserving its other entries and exclusions, then retry. " +
      "n-dx has not changed your filters or started model work.");
  }
}

/** Preserve config-loading options in their original order, including profile
 * selection. Exec-only flags are not accepted by app-server. The leading prefix
 * supports a selected Node wrapper just as the actual execution invocation does.
 */
function configArgs(args: readonly string[]): string[] {
  const execIndex = args.indexOf("exec");
  if (execIndex < 0) throw new ClaudeClientError(UNVERIFIED, "unknown", false);
  const result = [...args.slice(0, execIndex), "app-server", "--strict-config"];
  for (let i = execIndex + 1; i < args.length; i++) {
    const arg = args[i];
    if (["-c", "--config", "-p", "--profile", "--enable", "--disable"].includes(arg)) {
      if (args[i + 1] === undefined) throw new ClaudeClientError(UNVERIFIED, "unknown", false);
      result.push(arg, args[++i]);
    } else if (arg === "--ignore-user-config" || /^(--config|--profile|--enable|--disable)=/.test(arg) || /^-[cp].+/.test(arg)) {
      result.push(arg);
    } else if (arg.startsWith("-C") || arg === "--cd" || arg.startsWith("--cd=") || arg === "--trust" || arg === "--worktree") {
      throw new ClaudeClientError("Cannot verify Codex private temp with a CLI cwd/trust override. Start the caller in the intended worktree with its existing native trust configuration.", "unknown", false);
    }
  }
  return result;
}

export async function assertCodexScratchEnvironment(options: ScratchEnvironmentOptions): Promise<void> {
  const config = await readCodexEffectiveConfig(options);
  if (config) {
    try { checkConfig(config, options.scratchDir); }
    catch (error) { throw new ClaudeClientError((error as Error).message, "unknown", false); }
  }
}

/** Read the selected CLI's effective configuration without starting a thread.
 * Returns undefined only on cancellation. Never logs native configuration,
 * which can contain credentials. Callers must not persist the returned object.
 */
export async function readCodexEffectiveConfig(
  options: Omit<ScratchEnvironmentOptions, "scratchDir">,
): Promise<Record<string, unknown> | undefined> {
  if (options.signal?.aborted) return;
  const args = configArgs(options.args);
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawnCli> | undefined;
    let done = false;
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let bytes = 0;
    let initialized = false;
    let stderrTail = "";
    let rejectedSelector: string | undefined;
    let config: Record<string, unknown> | undefined;
    let userAgent: unknown;
    const finish = (error?: Error, reason: "unknown" | "not-found" = "unknown"): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      const settle = () => error ? reject(new ClaudeClientError(error.message, reason, false)) : resolve(config);
      if (!child) { settle(); return; }
      child.stdin?.end();
      void terminateProcessTree(child, { forceKillTimeoutMs: 250, scanTimeoutMs: 500 })
        .then(settle, () => reject(new ClaudeClientError(UNVERIFIED, "unknown", false)));
    };
    const abort = () => {
      config = undefined; // A pending requirements read has only a partial snapshot.
      finish();
    };
    const timer = setTimeout(() => finish(new Error(UNVERIFIED)), options.timeoutMs ?? 5000);
    options.signal?.addEventListener("abort", abort, { once: true });
    const send = (message: unknown) => child?.stdin?.write(`${JSON.stringify(message)}\n`);
    const missingBinary = () => finish(new Error(diagnoseCliInvocation(options.binary, "llm.codex.cli_path").message), "not-found");
    const spawnError = (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? missingBinary() : finish(new Error(UNVERIFIED));
    try {
      child = spawnCli(options.binary, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      spawnError(error as NodeJS.ErrnoException);
      return;
    }
    child.on("error", spawnError);
    child.on("close", () => {
      if (done) return;
      if (process.platform === "win32" && diagnoseCliNotFound(stderrTail, options.binary)) {
        missingBinary();
        return;
      }
      finish(new Error(rejectedSelector
        ? `Codex app-server rejects ${rejectedSelector}, so it cannot verify the private TMPDIR, TMP and TEMP for this exec configuration. Select a CLI supporting the same configuration option on both exec and app-server. No model work was started.`
        : UNVERIFIED));
    });
    // A CLI that rejects argv may close stdin before its diagnostic arrives.
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") finish(new Error(UNVERIFIED));
    });
    // Recognize only known option names. Native stderr may contain secrets.
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = stderrTail + chunk.toString();
      rejectedSelector ??= /unexpected argument '(--ignore-user-config|--profile|-p)'/.exec(text)?.[1];
      stderrTail = text.slice(-4096);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { finish(new Error(UNVERIFIED)); return; }
      buffer += decoder.write(chunk);
      let newline: number;
      while (!done && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = record(JSON.parse(line));
          if (message?.id !== (initialized ? (config ? 3 : 2) : 1)) continue;
          const result = record(message.result);
          if (message.error || !result) throw new Error(UNVERIFIED);
          if (!initialized) {
            initialized = true;
            userAgent = result.userAgent;
            send({ method: "initialized", params: {} });
            send({ id: 2, method: "config/read", params: { cwd: options.cwd, includeLayers: options.includeLayersAndRequirements === true } });
          } else if (!config) {
            config = record(result.config);
            if (!config) throw new Error(UNVERIFIED);
            if (options.includeLayersAndRequirements) {
              if (!Array.isArray(result.layers)) throw new Error(UNVERIFIED);
              config = { config, layers: result.layers, userAgent };
              send({ id: 3, method: "configRequirements/read", params: {} });
            } else finish();
          } else {
            if (!Object.hasOwn(result, "requirements")) throw new Error(UNVERIFIED);
            config.requirements = result.requirements;
            finish();
          }
        } catch (error) {
          finish(error instanceof SyntaxError ? new Error(UNVERIFIED) : error as Error);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "n-dx", title: "n-dx private temp check", version: "1.0.0" } } });
  });
}
