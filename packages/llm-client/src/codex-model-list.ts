/** Read the selected CLI's client catalog, never an inference entitlement check. */
import { spawnCli } from "./exec.js";
import { terminateProcessTree } from "./process-tree.js";
import type { VendorModelListing } from "./vendor-model-list.js";

export interface CodexModelListOptions {
  binary: string;
  cwd: string;
  /** Must be the effective vendor environment after trust and credential filtering. */
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** No thread or inference request is created; no API key is required. */
export async function listCodexModels(options: CodexModelListOptions): Promise<VendorModelListing & { reasoningEfforts?: Record<string, string[]> }> {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawnCli>;
    let done = false;
    let buffer = "";
    let bytes = 0;
    let requestId = 1;
    let initialized = false;
    const models = new Set<string>();
    const reasoningEfforts: Record<string, string[]> = {};
    const cursors = new Set<string>();
    const failure = (reason: string): VendorModelListing => ({ ok: false, reason });
    const finish = (result: VendorModelListing & { reasoningEfforts?: Record<string, string[]> }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!child) { resolve(result); return; }
      child.stdin?.end();
      void terminateProcessTree(child, { forceKillTimeoutMs: 250, scanTimeoutMs: 500 })
        .then(() => resolve(result), () => resolve(failure("Codex catalog cleanup failed; restart Codex before refreshing.")));
    };
    const timer = setTimeout(() => finish(failure(`Codex model/list timed out after ${timeoutMs}ms; check CLI login and connectivity, then refresh.`)), timeoutMs);
    const send = (message: unknown): void => { child.stdin?.write(`${JSON.stringify(message)}\n`); };
    const list = (cursor?: string): void => {
      send({ id: ++requestId, method: "model/list", params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
    };
    try {
      child = spawnCli(options.binary, ["app-server"], { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      finish(failure("Codex app-server could not start; check llm.codex.cli_path and update the CLI."));
      return;
    }
    child.on("error", () => finish(failure("Codex app-server could not start; check llm.codex.cli_path and update the CLI.")));
    child.on("close", () => finish(failure("Codex app-server exited before model/list completed; check CLI login and app-server support, then refresh.")));
    child.stdin?.on("error", () => finish(failure("Codex app-server input closed; update the CLI and retry.")));
    // Drain stderr without publishing it: diagnostics can contain credentials.
    child.stderr?.resume();
    child.stdout?.on("data", (chunk: Buffer) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { finish(failure("Codex catalog exceeded the response limit; update the CLI and retry.")); return; }
      buffer += chunk.toString();
      let newline: number;
      while (!done && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: { id?: number; error?: unknown; result?: { data?: unknown; nextCursor?: unknown } };
        try { message = JSON.parse(line); } catch {
          finish(failure("Codex app-server returned invalid JSON; update the CLI and retry.")); return;
        }
        if (!message || message.id !== requestId) continue;
        if (message.error || !message.result) {
          finish(failure("Codex rejected the catalog request; check CLI login, provider configuration and app-server support, then refresh.")); return;
        }
        if (!initialized) {
          initialized = true;
          send({ method: "initialized", params: {} });
          list();
          continue;
        }
        if (!Array.isArray(message.result.data)) {
          finish(failure("Codex model/list returned an unexpected response; update the CLI and retry.")); return;
        }
        for (const entry of message.result.data) {
          if (entry && typeof entry.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(entry.model) && entry.hidden !== true) {
            models.add(entry.model);
            if (Array.isArray(entry.supportedReasoningEfforts)) {
              reasoningEfforts[entry.model] = entry.supportedReasoningEfforts
                .map((item: { reasoningEffort?: unknown }) => item?.reasoningEffort)
                .filter((value: unknown): value is string => typeof value === "string" && /^[a-z]+$/.test(value));
            }
          }
        }
        const cursor = message.result.nextCursor;
        if (cursor != null) {
          if (typeof cursor !== "string" || cursors.has(cursor) || cursors.size >= 100) {
            finish(failure("Codex model/list returned invalid pagination; update the CLI and retry.")); return;
          }
          cursors.add(cursor);
          list(cursor);
        } else {
          finish(models.size ? { ok: true, models: [...models].sort(), ...(Object.keys(reasoningEfforts).length ? { reasoningEfforts } : {}) } : failure("Codex listed no picker models; check CLI login and provider configuration, then refresh."));
        }
      }
    });
    send({ id: requestId, method: "initialize", params: { clientInfo: { name: "n-dx", title: "n-dx model catalog", version: "1.0.0" } } });
  });
}
