/**
 * Gemini CLI provider — calls Gemini via a local `gemini` command.
 *
 * This provider follows the same client contract used by Claude and Codex providers.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ClaudeClient,
  CompletionRequest,
  CompletionResult,
} from "./types.js";
import { ClaudeClientError } from "./types.js";
import type { GeminiConfig } from "./llm-types.js";
import { NEWEST_MODELS } from "./config.js";
import { spawnTool } from "./exec.js";

const AUTH_PATTERNS = /unauthorized|invalid api key|rejected|forbidden|not logged in|login required|auth failed|\b401\b/i;
const RATE_LIMIT_PATTERNS = /rate.limit|429|too many requests|overloaded/i;
const TRANSIENT_PATTERNS = [
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b529\b/,
  /\b429\b/,
  /overloaded/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /socket hang up/i,
];

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_GEMINI_BINARY = "gemini";
export const DEFAULT_GEMINI_MODEL = NEWEST_MODELS.gemini;

export interface GeminiCliProviderOptions {
  geminiConfig?: GeminiConfig;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function resolveGeminiCliPath(geminiConfig?: GeminiConfig): string {
  return geminiConfig?.cli_path ?? DEFAULT_GEMINI_BINARY;
}

function resolveGeminiModel(geminiConfig?: GeminiConfig): string {
  return geminiConfig?.model ?? DEFAULT_GEMINI_MODEL;
}

function isTransientError(message: string): boolean {
  return TRANSIENT_PATTERNS.some((p) => p.test(message));
}

function classifyStderr(stderr: string): { reason: "auth" | "rate-limit" | "unknown"; retryable: boolean } {
  const text = stderr.toLowerCase();
  if (AUTH_PATTERNS.test(text)) return { reason: "auth", retryable: false };
  if (RATE_LIMIT_PATTERNS.test(text)) return { reason: "rate-limit", retryable: true };
  return { reason: "unknown", retryable: isTransientError(text) };
}

async function spawnOnce(
  cliBinary: string,
  request: CompletionRequest,
  geminiConfig?: GeminiConfig,
): Promise<CompletionResult> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-gemini-"));
  const inputPath = join(dir, "prompt.txt");
  const outputPath = join(dir, "output.txt");

  try {
    await writeFile(inputPath, request.prompt);

    // Assuming a generic interface: gemini chat --model <model> --file <input> --output <output>
    // Adjust these flags if the Gemini CLI uses different subcommands/flags.
    const args = [
      "chat",
      "--model",
      request.model || resolveGeminiModel(geminiConfig),
      "--file",
      inputPath,
      "--output",
      outputPath,
      ...(request.cliFlags ?? []),
    ];

    const { exitCode, stderr } = await spawnTool(cliBinary, args, {
      stdio: "pipe",
      env: process.env,
    });

    if (exitCode !== 0) {
      const detail = stderr.trim() || `gemini exited with code ${exitCode}`;
      const classified = classifyStderr(detail);
      throw new ClaudeClientError(
        detail,
        classified.reason,
        classified.retryable,
      );
    }

    const text = (await readFile(outputPath, "utf-8")).trim();
    if (text.length === 0) {
      throw new ClaudeClientError(
        "Gemini CLI produced empty output",
        "unknown",
        true,
      );
    }

    return { text };
  } catch (err) {
    if (err instanceof ClaudeClientError) throw err;
    const message = (err as Error).message;
    if (message.includes("ENOENT")) {
      throw new ClaudeClientError(
        `Gemini CLI not found: ${cliBinary}`,
        "not-found",
        false,
      );
    }
    throw new ClaudeClientError(message, "unknown", isTransientError(message));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createGeminiCliClient(options: GeminiCliProviderOptions): ClaudeClient {
  const cliBinary = resolveGeminiCliPath(options.geminiConfig);
  const defaultModel = resolveGeminiModel(options.geminiConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  return {
    mode: "cli",
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      let lastError: Error | undefined;
      const finalRequest = { ...request, model: request.model || defaultModel };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await spawnOnce(cliBinary, finalRequest, options.geminiConfig);
        } catch (err) {
          lastError = err as Error;
          if (err instanceof ClaudeClientError && !err.retryable) throw err;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, Math.min(baseDelayMs * 2 ** attempt, 10000)));
          }
        }
      }
      throw lastError;
    },
  };
}
