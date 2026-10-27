/**
 * Vendor session drivers — what each vendor CLI needs to run, resume and
 * report one turn of a multi-turn session.
 *
 * A driver is stateless vendor knowledge: the argv and stdin for a turn
 * (fresh, resumed or forked), how one output line becomes a normalized
 * {@link RuntimeEvent}, which line names the session, and where token usage
 * sits. Two consumers share it:
 *
 * - hench's vendor adapters, which own their spawn loop (livelock and
 *   plan-mode intercepts, retries) and delegate argv, parsing and session-id
 *   capture here — so the batch and fork strategies resume through exactly
 *   these args.
 * - {@link startVendorSession} / {@link resumeVendorSession} in
 *   `vendor-session.ts`, the runtime the Sidecar drives.
 *
 * Lifted from `hench/src/agent/lifecycle/adapters/{claude,codex}-cli-adapter.ts`.
 * Behaviour is unchanged; the adapters' own tests pin it.
 *
 * @module llm-client/vendor-session-driver
 */

import type { LLMVendor } from "./provider-interface.js";
import { LLM_VENDOR } from "./provider-interface.js";
import type {
  FailureCategory,
  RuntimeEvent,
  RuntimeEventType,
} from "./runtime-contract.js";
import type { UsageMessageFilter } from "./usage-dedup.js";
import {
  mapCodexUsageToTokenUsage,
  parseStreamTokenUsageWithDiagnostic,
} from "./token-usage.js";

/** Default cap on assistant and completion text: hench keeps run summaries short. */
const MAX_SUMMARY_LENGTH = 500;
const MAX_TOOL_OUTPUT_LENGTH = 2000;

/** How {@link VendorSessionDriver.parseLine} shapes an event. */
export interface ParseLineOptions {
  /**
   * Longest assistant or completion text kept, default 500 — what hench's run
   * records summarize with. A conversation that shows the reply passes
   * `Infinity` to keep all of it.
   */
  readonly textLimit?: number;
}

// ── Turn arguments ───────────────────────────────────────────────────────

/** Which existing session a turn continues. */
export interface SessionResume {
  /** Vendor session id (Claude `session_id`, Codex `thread_id`). */
  readonly sessionId: string;
  /**
   * Branch the session instead of continuing it: the turn inherits the
   * transcript under a new id and leaves the original unmutated. Only a
   * driver with {@link VendorSessionDriver.canFork} honours it; the others
   * continue the session.
   */
  readonly fork?: boolean;
}

/** Claude-only flags. Other drivers ignore them. */
export interface ClaudeTurnFlags {
  /** `--allowed-tools` entries. Absent omits the flag. */
  readonly allowedTools?: readonly string[];
  /**
   * `--tools`: the only built-in tools the session gets. Unlike a deny list,
   * an allowlist also excludes built-ins a later CLI release adds. Absent
   * omits the flag (every built-in).
   */
  readonly tools?: readonly string[];
  /**
   * `--setting-sources`: which settings files load (`user`, `project`,
   * `local`). Empty loads none, so no `permissions.allow` rule in them can
   * approve a call. Absent omits the flag (all of them).
   */
  readonly settingSources?: readonly string[];
  /** `--effort <level>`, already validated for the model. */
  readonly effort?: string;
  /** `--permission-mode <mode>`. */
  readonly permissionMode?: string;
  /** `--mcp-config <file> --strict-mcp-config`. */
  readonly mcpConfigPath?: string;
}

/** Codex-only flags. Other drivers ignore them. */
export interface CodexTurnFlags {
  /**
   * Sandbox and approval flags for a fresh `codex exec`
   * (see `compileCodexPolicyFlags`). Dropped on resume: the resumed thread
   * keeps its own policy, and `exec resume` rejects the flags.
   */
  readonly policyFlags?: readonly string[];
}

export interface SessionTurnInput {
  /** System prompt. Empty means none is sent. */
  readonly systemPrompt: string;
  /** The turn's prompt. */
  readonly prompt: string;
  /** Model override. */
  readonly model?: string;
  /** Continue (or fork) this session; absent starts a fresh one. */
  readonly resume?: SessionResume;
  readonly claude?: ClaudeTurnFlags;
  readonly codex?: CodexTurnFlags;
}

/** Everything needed to spawn one turn. Binary resolution is the caller's. */
export interface SessionTurnSpawn {
  /** Default binary name (`claude`, `codex`). */
  readonly binary: string;
  readonly args: string[];
  /** Written to stdin, then stdin is closed. Never argv: see the drivers. */
  readonly stdin: string;
}

// ── Driver contract ──────────────────────────────────────────────────────

export interface VendorSessionDriver {
  readonly vendor: LLMVendor;
  /** Whether a session can be branched by id (Claude `--fork-session`). */
  readonly canFork: boolean;
  /**
   * Build one turn's spawn.
   *
   * @param platform Overridable only so tests can exercise the Windows
   *   delivery shape on any host.
   */
  turnSpawn(input: SessionTurnInput, platform?: NodeJS.Platform): SessionTurnSpawn;
  /** Normalize one stdout line; `null` for lines that carry no event. */
  parseLine(line: string, turn: number, options?: ParseLineOptions): RuntimeEvent | null;
  /** The session id one parsed line names, if it names one. */
  extractSessionId(rawJson: unknown): string | undefined;
  /**
   * A `token_usage` event for one parsed line, or `null`.
   *
   * @param seen Drops a message already counted (Claude repeats a message's
   *   usage on every content block).
   * @param turnHasUsage Whether this turn already counted usage; a
   *   turn-total line (Claude `result`) is only a fallback for that case.
   */
  usageEvent(
    rawJson: unknown,
    turn: number,
    seen: UsageMessageFilter,
    turnHasUsage: boolean,
  ): RuntimeEvent | null;
}

// ── Claude ───────────────────────────────────────────────────────────────

/** Separates the system prompt from the task prompt when both travel via stdin. */
export const WINDOWS_STDIN_PROMPT_SEPARATOR = "\n\n---\n\n";

function claudeTurnSpawn(
  input: SessionTurnInput,
  platform: NodeJS.Platform = process.platform,
): SessionTurnSpawn {
  const isWindows = platform === "win32";
  const flags = input.claude ?? {};
  const allowedTools = flags.allowedTools;
  const hasSystem = input.systemPrompt.length > 0;

  // On Windows, cmd.exe can't handle multi-line strings or special chars
  // like ( ) & | in CLI args. Embed the system prompt in stdin instead.
  const stdin = isWindows && hasSystem
    ? `${input.systemPrompt}${WINDOWS_STDIN_PROMPT_SEPARATOR}${input.prompt}`
    : input.prompt;

  const args = [
    "-p", // print mode; prompt is read from stdin
    "--output-format", "stream-json",
    "--verbose",
    ...(!isWindows && hasSystem ? ["--system-prompt", input.systemPrompt] : []),
    // Absent means the session's own permission settings decide.
    ...(allowedTools
      ? [
          "--allowed-tools",
          // On Windows: one comma-separated token. spawnCli/quoteWindowsToken
          // is the sole quoting authority — no manual wrapping here.
          ...(isWindows ? [allowedTools.join(",")] : allowedTools),
        ]
      : []),
    // One comma-separated token on every platform. An empty list becomes an
    // empty argument ("none"), not an omitted flag ("all").
    ...(flags.tools ? ["--tools", flags.tools.join(",")] : []),
    ...(flags.settingSources ? ["--setting-sources", flags.settingSources.join(",")] : []),
    ...(input.model ? ["--model", input.model] : []),
    ...(flags.effort ? ["--effort", flags.effort] : []),
    ...(flags.permissionMode ? ["--permission-mode", flags.permissionMode] : []),
    // A file path, never inline JSON: an inline document would have to survive
    // cmd.exe quoting on Windows. --strict-mcp-config makes the file the
    // session's only source of MCP servers.
    ...(flags.mcpConfigPath ? ["--mcp-config", flags.mcpConfigPath, "--strict-mcp-config"] : []),
    // Last, so no earlier occurrence can shadow it. Forking is a modifier on
    // resume; emitting it alone would claim a fork that never happened.
    ...(input.resume ? ["--resume", input.resume.sessionId] : []),
    ...(input.resume?.fork ? ["--fork-session"] : []),
  ];

  return { binary: "claude", args, stdin };
}

/** Tool_use blocks embedded in a Claude assistant event. */
function extractClaudeToolUseBlocks(
  event: Record<string, unknown>,
): Array<{ name: string; input: Record<string, unknown> }> {
  const results: Array<{ name: string; input: Record<string, unknown> }> = [];
  const collect = (blocks: Array<Record<string, unknown>>): void => {
    for (const block of blocks) {
      if (block.type === "tool_use") {
        results.push({
          name: (block.name as string) || "unknown",
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }
  };

  const message = event.message;
  if (message && typeof message === "object") {
    const blocks = (message as Record<string, unknown>).content;
    if (Array.isArray(blocks)) collect(blocks as Array<Record<string, unknown>>);
  }
  const content = event.content;
  if (Array.isArray(content) && !event.message) {
    collect(content as Array<Record<string, unknown>>);
  }
  return results;
}

/**
 * Parse one line of Claude `--output-format stream-json` into a RuntimeEvent.
 *
 * Lines that carry no event (empty, non-JSON, unknown types, usage-only
 * assistant messages) return `null`. Token usage is {@link VendorSessionDriver.usageEvent}'s.
 */
export function parseClaudeStreamLine(
  line: string,
  turn: number,
  { textLimit: limit = MAX_SUMMARY_LENGTH }: ParseLineOptions = {},
): RuntimeEvent | null {
  if (!line.trim()) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  const type = event.type as string | undefined;
  const timestamp = new Date().toISOString();
  const vendor: LLMVendor = LLM_VENDOR.CLAUDE;

  switch (type) {
    case "assistant": {
      const message = event.message;
      let text: string | undefined;

      if (typeof message === "string") {
        text = message.slice(0, limit);
      } else if (message && typeof message === "object") {
        const blocks = (message as Record<string, unknown>).content as
          | Array<{ type: string; text?: string }>
          | undefined;
        if (Array.isArray(blocks)) {
          const textBlock = blocks.find((b) => b.type === "text" && b.text);
          if (textBlock?.text) text = textBlock.text;
        }
      }

      // Some event shapes put the content at the top level.
      if (!text) {
        const content = event.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(content) && !event.message) {
          const textBlock = content.find((b) => b.type === "text" && b.text);
          if (textBlock?.text) text = textBlock.text;
        }
      }

      // The first tool_use wins; the caller sees one event per line.
      const toolBlocks = extractClaudeToolUseBlocks(event);
      if (toolBlocks.length > 0) {
        const firstTool = toolBlocks[0];
        return {
          type: "tool_use" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          text,
          toolCall: { tool: firstTool.name, input: firstTool.input },
        };
      }

      if (text) {
        return { type: "assistant" as RuntimeEventType, vendor, turn, timestamp, text };
      }
      return null;
    }

    case "tool_use": {
      const toolName = (event.tool as string) || (event.name as string) || "unknown";
      const toolInput = (event.input as Record<string, unknown>) || {};
      return {
        type: "tool_use" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolCall: { tool: toolName, input: toolInput },
      };
    }

    case "tool_result": {
      const output = (event.output as string) || (event.content as string) || "";
      return {
        type: "tool_result" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolResult: {
          tool: "unknown", // Claude's stream carries no tool name on results
          output: output.slice(0, MAX_TOOL_OUTPUT_LENGTH),
          durationMs: 0,
        },
      };
    }

    case "result": {
      if (event.is_error) {
        return {
          type: "failure" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          failure: {
            category: "unknown" as FailureCategory,
            message: (event.result as string) || "Unknown error",
          },
        };
      }
      return {
        type: "completion" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        completionSummary: event.result
          ? (event.result as string).slice(0, limit)
          : undefined,
      };
    }

    default:
      return null;
  }
}

/**
 * The Claude CLI stamps `session_id` on many stream-json lines. Callers keep
 * the first value of a turn so a late payload cannot redirect a resume.
 */
export function extractClaudeSessionId(rawJson: unknown): string | undefined {
  if (!rawJson || typeof rawJson !== "object") return undefined;
  const id = (rawJson as Record<string, unknown>).session_id;
  return typeof id === "string" && id ? id : undefined;
}

function usageRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function claudeUsageEvent(
  rawJson: unknown,
  turn: number,
  seen: UsageMessageFilter,
  turnHasUsage: boolean,
): RuntimeEvent | null {
  const raw = usageRecord(rawJson);
  if (!raw) return null;

  let usage: Record<string, unknown> | undefined;
  if (raw.type === "result") {
    // The turn's total. Counting it beside the per-message usage would count
    // the turn twice, so it only stands in when no message reported any.
    if (turnHasUsage) return null;
    usage = usageRecord(raw.usage);
  } else {
    usage = usageRecord(usageRecord(raw.message)?.usage);
  }
  if (!usage) return null;
  if (!seen.accept(rawJson)) return null;

  const parsed = parseStreamTokenUsageWithDiagnostic(usage);
  if (parsed.diagnosticStatus === "unavailable") return null;
  return {
    type: "token_usage",
    vendor: LLM_VENDOR.CLAUDE,
    turn,
    timestamp: new Date().toISOString(),
    tokenUsage: parsed.usage,
    tokenDiagnosticStatus: parsed.diagnosticStatus,
    tokenCacheProvenance: parsed.cacheProvenance,
  };
}

export const claudeSessionDriver: VendorSessionDriver = {
  vendor: LLM_VENDOR.CLAUDE,
  canFork: true,
  turnSpawn: claudeTurnSpawn,
  parseLine: parseClaudeStreamLine,
  extractSessionId: extractClaudeSessionId,
  usageEvent: claudeUsageEvent,
};

// ── Codex ────────────────────────────────────────────────────────────────

function codexTurnSpawn(input: SessionTurnInput): SessionTurnSpawn {
  // The prompt always travels on stdin (trailing "-"), never argv: cmd.exe
  // treats CR/LF in an argv token as a command separator regardless of
  // quoting (BatBadBut / CVE-2024-24576 class), and a bounded brief can
  // exceed ARG_MAX for one argv element.
  const stdin = input.systemPrompt
    ? `SYSTEM:\n${input.systemPrompt}\n\nTASK:\n${input.prompt}`
    : input.prompt;
  const modelArgs = input.model ? ["-m", input.model] : [];

  // Codex cannot fork, so a resume always appends to the thread. Two
  // differences from a fresh exec, both dictated by `codex exec resume`:
  //   1. No policy flags — resume rejects `-s/--sandbox` and
  //      `--approve-for-me`; the thread keeps the policy it started with.
  //   2. The id is always explicit, never `--last`, which picks the newest
  //      session on the machine and would let any other codex run capture it.
  if (input.resume) {
    return {
      binary: "codex",
      args: [
        "exec", "resume", input.resume.sessionId,
        "--json", "--skip-git-repo-check",
        ...modelArgs,
        "-", // resume reads the follow-up prompt from stdin
      ],
      stdin,
    };
  }

  return {
    binary: "codex",
    args: [
      "exec",
      ...(input.codex?.policyFlags ?? []),
      "--json", "--skip-git-repo-check",
      ...modelArgs,
      "-", // codex exec reads the prompt from stdin
    ],
    stdin,
  };
}

/**
 * Parse a string that might be JSON. Returns the parsed value, or the input
 * unchanged when it is not a JSON object or array.
 */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** Codex uses several field names for a content block's type. */
function getBlockType(block: Record<string, unknown>): string | undefined {
  const type = block.type ?? block.kind ?? block.event ?? block.block_type ?? block.role;
  return typeof type === "string" ? type : undefined;
}

/** Content blocks from the many shapes a Codex response can take. */
function collectCodexBlocks(payload: unknown): Array<Record<string, unknown>> {
  const records = (list: unknown[]): Array<Record<string, unknown>> =>
    list.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);

  if (Array.isArray(payload)) return records(payload);
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.content,
    obj.blocks,
    obj.events,
    obj.output,
    obj.items,
    obj.response,
    obj.data,
    obj.message && typeof obj.message === "object" ? (obj.message as Record<string, unknown>).content : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return records(candidate);
  }
  return [];
}

/** Text from a Codex block, checking the field names it uses. */
function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.delta === "string") return obj.delta;
  if (typeof obj.output_text === "string") return obj.output_text;
  return "";
}

/** A single tool event extracted from a Codex response. */
export interface NormalizedCodexToolEvent {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status?: string;
  eventType: string;
}

/** The result of normalizing an unstructured Codex response. */
export interface NormalizedCodexResponse {
  status: "completed" | "error" | "in_progress" | "unknown";
  assistantText: string;
  toolEvents: NormalizedCodexToolEvent[];
  warnings: string[];
  error?: string;
}

function toolNameOf(block: Record<string, unknown>): string {
  return typeof block.name === "string"
    ? block.name
    : typeof block.tool === "string"
      ? block.tool
      : "unknown";
}

/**
 * Heuristic parser for unstructured Codex output — the fallback when Codex
 * does not emit structured JSONL (older versions without `--json`).
 */
export function normalizeCodexResponse(raw: unknown): NormalizedCodexResponse {
  const warnings: string[] = [];
  const textParts: string[] = [];
  const toolEvents: NormalizedCodexToolEvent[] = [];

  const parsedRaw = parseMaybeJson(raw);
  const parsed = typeof parsedRaw === "string" ? parseMaybeJson(parsedRaw.trim()) : parsedRaw;

  if (typeof parsed === "string") {
    return { status: "completed", assistantText: parsed, toolEvents, warnings };
  }
  if (!parsed || typeof parsed !== "object") {
    return { status: "unknown", assistantText: "", toolEvents, warnings };
  }

  const obj = parsed as Record<string, unknown>;
  const topLevelText = [obj.text, obj.output_text, obj.result, obj.summary, obj.message]
    .map(extractText)
    .find((text) => text.trim().length > 0);
  if (topLevelText) textParts.push(topLevelText);

  for (const block of collectCodexBlocks(obj)) {
    const type = getBlockType(block);
    const normalizedType = type?.toLowerCase();

    if (!normalizedType) {
      warnings.push("Codex block missing type; ignoring block.");
      continue;
    }

    if (normalizedType === "text" || normalizedType === "output_text" || normalizedType === "assistant_text" || normalizedType === "text_delta") {
      const text = extractText(block);
      if (text) textParts.push(text);
      continue;
    }

    if (normalizedType === "tool_use" || normalizedType === "tool_call" || normalizedType === "function_call") {
      const inputCandidate = parseMaybeJson(block.input ?? block.arguments);
      toolEvents.push({
        tool: toolNameOf(block),
        input: inputCandidate && typeof inputCandidate === "object"
          ? inputCandidate as Record<string, unknown>
          : { value: inputCandidate },
        status: typeof block.status === "string" ? block.status : "started",
        eventType: normalizedType,
      });
      continue;
    }

    if (normalizedType === "tool_result" || normalizedType === "function_result") {
      toolEvents.push({
        tool: toolNameOf(block),
        input: {},
        output: extractText(block.output ?? block.content ?? block.result ?? block),
        status: typeof block.status === "string" ? block.status : "completed",
        eventType: normalizedType,
      });
      continue;
    }

    if (
      normalizedType === "completion" ||
      normalizedType === "completed" ||
      normalizedType === "result" ||
      normalizedType === "final"
    ) {
      const text = extractText(block.result ?? block.message ?? block);
      if (text) textParts.push(text);
      continue;
    }

    warnings.push(`Unknown Codex block type "${type}" ignored.`);
  }

  let status: NormalizedCodexResponse["status"] = "unknown";
  if (obj.is_error === true || typeof obj.error === "string") {
    status = "error";
  } else if (typeof obj.status === "string") {
    const s = obj.status.toLowerCase();
    if (s.includes("error") || s.includes("failed")) status = "error";
    else if (s.includes("complete") || s === "ok") status = "completed";
    else if (s.includes("progress") || s.includes("running")) status = "in_progress";
  } else if (typeof obj.stop_reason === "string") {
    status = obj.stop_reason === "end_turn" ? "completed" : "in_progress";
  } else if (textParts.length > 0 || toolEvents.length > 0) {
    status = "completed";
  }

  const assistantText = textParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");

  const error = typeof obj.error === "string"
    ? obj.error
    : obj.is_error
      ? extractText(obj.result) || "Codex response indicated an error"
      : undefined;

  return { status, assistantText, toolEvents, warnings, error };
}

/**
 * Parse one JSONL line of `codex exec --json` into a RuntimeEvent.
 *
 * Supported types: `item.started` (`command_execution` → `shell` tool_use),
 * `item.completed` (`agent_message` → assistant; `command_execution` →
 * `shell` tool_result; `file_change` → `apply_patch` tool_use), `message`,
 * `function_call`, `function_call_output`, `error`, `turn.failed`, and the
 * completion family (`summary`, `response.completed`, `done`, `complete`).
 * Anything else, and non-JSON, returns `null`.
 */
export function parseCodexJsonLine(
  line: string,
  turn: number,
  { textLimit: limit = MAX_SUMMARY_LENGTH }: ParseLineOptions = {},
): RuntimeEvent | null {
  if (!line.trim()) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  const type = event.type as string | undefined;
  if (!type) return null;

  const timestamp = new Date().toISOString();
  const vendor: LLMVendor = LLM_VENDOR.CODEX;
  const failure = (message: string): RuntimeEvent => ({
    type: "failure" as RuntimeEventType,
    vendor,
    turn,
    timestamp,
    failure: { category: "unknown" as FailureCategory, message },
  });

  switch (type) {
    case "item.started": {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "command_execution" && typeof item.command === "string") {
        return {
          type: "tool_use" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          toolCall: { tool: "shell", input: { command: item.command } },
        };
      }
      return null;
    }

    case "item.completed": {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return null;
      const itemType = typeof item.type === "string" ? item.type : undefined;

      if (itemType === "agent_message" && typeof item.text === "string") {
        return {
          type: "assistant" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          text: item.text.slice(0, limit),
        };
      }

      if (itemType === "command_execution") {
        const outputCandidate =
          (typeof item.aggregated_output === "string" && item.aggregated_output) ||
          (typeof item.output === "string" && item.output) ||
          (typeof item.stdout === "string" && item.stdout) ||
          (typeof item.result === "string" && item.result) ||
          (typeof item.text === "string" && item.text) ||
          "";
        return {
          type: "tool_result" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          toolResult: {
            tool: "shell",
            output: outputCandidate.slice(0, MAX_TOOL_OUTPUT_LENGTH),
            durationMs: 0,
          },
        };
      }

      // A patch Codex wrote. Named `apply_patch` because hench's livelock
      // detector counts that name as progress; without it every Codex command
      // is an identical `shell` call and a patch-then-retest loop reads as a
      // livelock (GH #370). A failed patch changed nothing, so it is dropped,
      // and no tool_result is paired: the change produced no output.
      if (itemType === "file_change") {
        const status = typeof item.status === "string" ? item.status.toLowerCase() : "";
        if (status === "failed") return null;
        const changes = Array.isArray(item.changes) ? item.changes : [];
        return {
          type: "tool_use" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          toolCall: { tool: "apply_patch", input: { changes } },
        };
      }

      return null;
    }

    case "message": {
      const content = event.content as Array<{
        type: string;
        text?: string;
        name?: string;
        input?: Record<string, unknown>;
        arguments?: string;
      }> | undefined;

      let text: string | undefined;
      let firstToolCall: { tool: string; input: Record<string, unknown> } | undefined;

      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block.type === "text" || block.type === "output_text") && block.text) {
            text = block.text.slice(0, limit);
          } else if ((block.type === "tool_use" || block.type === "function_call") && !firstToolCall) {
            const rawInput = block.input ?? parseMaybeJson(block.arguments);
            firstToolCall = {
              tool: block.name || "unknown",
              input: rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
                ? rawInput as Record<string, unknown>
                : {},
            };
          }
        }
      }

      if (typeof event.text === "string" && !content) {
        text = event.text.slice(0, limit);
      }

      if (firstToolCall) {
        return { type: "tool_use" as RuntimeEventType, vendor, turn, timestamp, text, toolCall: firstToolCall };
      }
      if (text) {
        return { type: "assistant" as RuntimeEventType, vendor, turn, timestamp, text };
      }
      return null;
    }

    case "function_call": {
      const rawArgs = parseMaybeJson(event.arguments);
      return {
        type: "tool_use" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolCall: {
          tool: (event.name as string) || "unknown",
          input: rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
            ? rawArgs as Record<string, unknown>
            : {},
        },
      };
    }

    case "function_call_output": {
      const output = (event.output as string) || (event.content as string) || "";
      return {
        type: "tool_result" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolResult: {
          tool: "unknown", // function_call_output carries no tool name
          output: output.slice(0, MAX_TOOL_OUTPUT_LENGTH),
          durationMs: 0,
        },
      };
    }

    case "error":
      return failure((event.message as string) || (event.error as string) || "Unknown error");

    case "turn.failed": {
      const error = event.error as Record<string, unknown> | undefined;
      return failure(
        (error && typeof error.message === "string" ? error.message : undefined) ||
          (typeof event.message === "string" ? event.message : undefined) ||
          "Unknown error",
      );
    }

    case "summary":
    case "response.completed":
    case "done":
    case "complete": {
      if (event.is_error === true) {
        return failure((event.result as string) || "Unknown error");
      }
      let summaryText: string | undefined;
      if (typeof event.result === "string") {
        summaryText = event.result.slice(0, limit);
      } else if (typeof event.text === "string") {
        summaryText = event.text.slice(0, limit);
      }
      return {
        type: "completion" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        completionSummary: summaryText,
      };
    }

    default:
      return null;
  }
}

/** The heuristic fallback for a line the structured parser could not map. */
function parseCodexHeuristicLine(line: string, turn: number, limit: number): RuntimeEvent | null {
  const normalized = normalizeCodexResponse(line);
  const timestamp = new Date().toISOString();
  const vendor: LLMVendor = LLM_VENDOR.CODEX;

  if (normalized.toolEvents.length > 0) {
    const first = normalized.toolEvents[0];
    return {
      type: "tool_use" as RuntimeEventType,
      vendor,
      turn,
      timestamp,
      text: normalized.assistantText || undefined,
      toolCall: { tool: first.tool, input: first.input },
    };
  }
  if (normalized.assistantText) {
    return {
      type: "assistant" as RuntimeEventType,
      vendor,
      turn,
      timestamp,
      text: normalized.assistantText.slice(0, limit),
    };
  }
  if (normalized.status === "error" && normalized.error) {
    return {
      type: "failure" as RuntimeEventType,
      vendor,
      turn,
      timestamp,
      failure: { category: "unknown" as FailureCategory, message: normalized.error },
    };
  }
  return null;
}

/** Structured JSONL first, then the heuristic for unstructured output. */
function parseCodexLine(line: string, turn: number, options: ParseLineOptions = {}): RuntimeEvent | null {
  const structured = parseCodexJsonLine(line, turn, options);
  if (structured) return structured;
  return line.trim()
    ? parseCodexHeuristicLine(line, turn, options.textLimit ?? MAX_SUMMARY_LENGTH)
    : null;
}

/**
 * Codex announces its thread once, as
 * `{"type":"thread.started","thread_id":"…"}` (codex-cli 0.147.0). Scoped to
 * that event so a later payload cannot redirect the next `exec resume`;
 * a resumed spawn re-emits the id it continued.
 */
export function extractCodexSessionId(rawJson: unknown): string | undefined {
  if (!rawJson || typeof rawJson !== "object") return undefined;
  const event = rawJson as Record<string, unknown>;
  if (event.type !== "thread.started") return undefined;
  const id = event.thread_id;
  return typeof id === "string" && id ? id : undefined;
}

function codexUsageEvent(
  rawJson: unknown,
  turn: number,
  seen: UsageMessageFilter,
): RuntimeEvent | null {
  const raw = usageRecord(rawJson);
  // `turn.completed` carries the turn's usage; nothing else in `--json` does.
  if (!raw || !usageRecord(raw.usage)) return null;
  if (!seen.accept(rawJson)) return null;

  const mapped = mapCodexUsageToTokenUsage(raw);
  if (mapped.diagnosticStatus === "unavailable") return null;
  return {
    type: "token_usage",
    vendor: LLM_VENDOR.CODEX,
    turn,
    timestamp: new Date().toISOString(),
    tokenUsage: mapped.usage,
    tokenDiagnosticStatus: mapped.diagnosticStatus,
    tokenCacheProvenance: mapped.cacheProvenance,
  };
}

export const codexSessionDriver: VendorSessionDriver = {
  vendor: LLM_VENDOR.CODEX,
  canFork: false,
  turnSpawn: codexTurnSpawn,
  parseLine: parseCodexLine,
  extractSessionId: extractCodexSessionId,
  usageEvent: codexUsageEvent,
};

// ── Lookup ───────────────────────────────────────────────────────────────

/**
 * The session driver for a vendor CLI, or `undefined` for a vendor whose CLI
 * cannot hold a resumable session (the API-only vendors).
 */
export function vendorSessionDriver(vendor: string): VendorSessionDriver | undefined {
  if (vendor === LLM_VENDOR.CLAUDE) return claudeSessionDriver;
  if (vendor === LLM_VENDOR.CODEX) return codexSessionDriver;
  return undefined;
}
