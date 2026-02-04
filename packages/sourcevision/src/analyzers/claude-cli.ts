/**
 * Claude CLI integration — spawns the `claude` process and parses stream-json output.
 */

import { spawn } from "node:child_process";
import { IDLE_TIMEOUT_MS, OVERALL_TIMEOUT_MS } from "./enrich-config.js";
import type { TokenUsage } from "../schema/index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ClaudeCallResult =
  | { ok: true; response: string; tokenUsage?: TokenUsage }
  | { ok: false; reason: "auth" | "timeout" | "rate-limit" | "unknown"; detail: string };

// ── Claude CLI call ──────────────────────────────────────────────────────────

export async function tryCallClaude(prompt: string, _timeoutMs: number): Promise<ClaudeCallResult> {
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const stderrChunks: Buffer[] = [];
    let resultText: string | null = null;
    let resultTokenUsage: TokenUsage | undefined;
    let settled = false;
    let lastActivity = Date.now();

    const finish = (result: ClaudeCallResult) => {
      if (settled) return;
      settled = true;
      clearInterval(idleCheck);
      clearTimeout(overallTimer);
      resolve(result);
    };

    const kill = (reason: string) => {
      child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 5_000);
      finish({ ok: false, reason: "timeout", detail: reason });
    };

    // Idle check: no stdout activity for IDLE_TIMEOUT_MS → stuck
    const idleCheck = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
        kill(`No output for ${Math.round(IDLE_TIMEOUT_MS / 1000)}s — process appears stuck`);
      }
    }, 10_000);

    // Hard overall cap
    const overallTimer = setTimeout(() => {
      kill(`Overall timeout after ${Math.round(OVERALL_TIMEOUT_MS / 1000)}s`);
    }, OVERALL_TIMEOUT_MS);

    // Buffer partial lines from stdout (stream-json is newline-delimited)
    let lineBuf = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      lastActivity = Date.now();
      lineBuf += chunk.toString("utf-8");
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? ""; // keep incomplete trailing line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "result") {
            resultText = typeof obj.result === "string" ? obj.result : null;
            resultTokenUsage = parseStreamTokenUsage(obj);
          }
        } catch { /* skip unparseable lines */ }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      const stderrStr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      if (code === 0 && resultText != null) {
        finish({ ok: true, response: resultText.trim(), tokenUsage: resultTokenUsage });
        return;
      }

      if (/auth|unauthorized|api.key|credential|login|not logged in/i.test(stderrStr)) {
        finish({ ok: false, reason: "auth", detail: stderrStr.slice(0, 300) });
        return;
      }
      if (/rate.limit|429|too many requests|overloaded/i.test(stderrStr)) {
        finish({ ok: false, reason: "rate-limit", detail: stderrStr.slice(0, 300) });
        return;
      }

      finish({ ok: false, reason: "unknown", detail: (stderrStr || `Exit code ${code}`).slice(0, 300) });
    });

    child.on("error", (err) => {
      finish({ ok: false, reason: "unknown", detail: err.message.slice(0, 300) });
    });

    // Write prompt to stdin and close it
    child.stdin!.write(prompt, "utf-8");
    child.stdin!.end();
  });
}

// ── Token usage parsing ──────────────────────────────────────────────────────

/**
 * Parse token usage from a stream-json result event.
 * Claude CLI stream-json result events may include token usage at the top level
 * or nested under a `usage` property.
 */
export function parseStreamTokenUsage(obj: Record<string, unknown>): TokenUsage | undefined {
  // Try direct fields first (some CLI versions)
  let input = obj.input_tokens ?? obj.total_input_tokens;
  let output = obj.output_tokens ?? obj.total_output_tokens;
  let cacheCreation = obj.cache_creation_input_tokens;
  let cacheRead = obj.cache_read_input_tokens;

  // Try nested usage object (stream-json format)
  if (typeof input !== "number" && typeof output !== "number" && obj.usage && typeof obj.usage === "object") {
    const usage = obj.usage as Record<string, unknown>;
    input = usage.input_tokens ?? usage.total_input_tokens;
    output = usage.output_tokens ?? usage.total_output_tokens;
    cacheCreation = usage.cache_creation_input_tokens;
    cacheRead = usage.cache_read_input_tokens;
  }

  if (typeof input !== "number" && typeof output !== "number") {
    return undefined;
  }

  const tokenUsage: TokenUsage = {
    input: typeof input === "number" ? input : 0,
    output: typeof output === "number" ? output : 0,
  };

  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    tokenUsage.cacheCreationInput = cacheCreation;
  }
  if (typeof cacheRead === "number" && cacheRead > 0) {
    tokenUsage.cacheReadInput = cacheRead;
  }

  return tokenUsage;
}
