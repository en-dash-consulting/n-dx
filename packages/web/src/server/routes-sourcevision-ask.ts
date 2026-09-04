/**
 * SourceVision Ask API route — a natural-language question about the analyzed
 * project, answered from the existing `.sourcevision/` analysis.
 *
 * POST /api/sourcevision/ask
 *   body     { prompt: string, seed?: { kind?, id?, text?, zone?, files?, labels? } }
 *   200      { answer, vendor, model, tokens, contextSources }
 *   4xx/5xx  { error, kind, suggestion?, retryAfterMs? }
 *
 * The endpoint is deliberately **not** on the `/api/sv/` prefix that serves the
 * raw analysis artifacts: those are cacheable reads of files on disk, this one
 * spends tokens on every call. Keeping it on its own path means the request
 * security and scope layers can treat the two differently without parsing the
 * artifact route's path segments.
 *
 * ## Grounding
 *
 * Context comes from {@link assembleAskContext}, which reads only the analysis
 * artifacts. Vendor and model are resolved from the project's own LLM config
 * (`.n-dx.json` merged with `.n-dx.local.json`) through `loadLLMConfig` and
 * `resolveTaskModel` — the same resolution path the CLIs use — and the pair
 * that actually served the call is reported back, so the panel never has to
 * guess which model produced an answer.
 *
 * ## Failure modes
 *
 * Every failure returns a named `kind` rather than a bare 500. The two that
 * matter operationally are distinguished from each other and from everything
 * else: `timeout` (the call outlived the configured budget) and `rate_limit`
 * (the vendor refused, with the retry delay when it supplied one). A request
 * cannot hang — the LLM call races a timer, and the response is sent when the
 * timer wins even though the provider may still be finishing in the
 * background.
 *
 * ## Accounting
 *
 * Every attempted call is written to the dashboard spend ledger, including the
 * ones that fail: a rate-limited or timed-out ask still cost something, and a
 * ledger that only records answers would report the dashboard as cheaper than
 * it is. A provider that finishes after the timer already answered the request
 * appends its counts as a second, call-free record — see
 * {@link recordDashboardUsage}.
 *
 * @module web/server/routes-sourcevision-ask
 * @see sourcevision-ask-context.ts — bundle assembly (all sourcevision reads)
 * @see dashboard-usage.ts — the ledger the utilization view aggregates
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ClaudeClientError,
  DEFAULT_LLM_VENDOR,
  classifyLLMError,
  createLLMClient,
  deepMerge,
  loadLLMConfig,
  resolveTaskModel,
} from "@n-dx/llm-client";
import type {
  CompletionRequest,
  CompletionResult,
  LLMClient,
  LLMConfig,
  LLMVendor,
  TokenUsage,
} from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, readBody } from "./response-utils.js";
import { readCliName } from "./cli-name.js";
import { assembleAskContext } from "./sourcevision-ask-context.js";
import { ASK_COMMAND, recordDashboardUsage, tokenFields } from "./dashboard-usage.js";
import type { DashboardUsageOutcome } from "./dashboard-usage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ASK_PATH = "/api/sourcevision/ask";

/**
 * Default budget for one Ask call, overridable via
 * `sourcevision.ask.timeoutMs` in `.n-dx.json` (or `.n-dx.local.json`).
 *
 * Two minutes rather than the 30-minute CLI default: this is a person waiting
 * on a textarea, not a background analyze run, and the panel needs a bounded
 * failure it can render. Set the config value to 0 to wait indefinitely.
 */
const DEFAULT_ASK_TIMEOUT_MS = 120_000;

const MAX_PROMPT_CHARS = 4_000;
const MAX_SEED_TEXT_CHARS = 8_000;

/**
 * Files accepted on a seed — a request-size guard, deliberately looser than
 * the assembler's rendering cap. The assembler decides how many fit the
 * context budget and says how many it dropped; this only refuses a body large
 * enough to be a mistake.
 */
const MAX_SEED_FILES = 100;

const NDX_CONFIG = ".n-dx.json";
const NDX_LOCAL_CONFIG = ".n-dx.local.json";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

/**
 * Accepted request body.
 *
 * `.strict()` on both objects: an unrecognised key is far more likely to be a
 * client that thinks it is sending something the server honours (a model
 * override, a system prompt) than a harmless extra, and silently dropping it
 * would make that client's behaviour inexplicable.
 */
const AskRequestSchema = z
  .object({
    prompt: z.string().trim().min(1, "prompt must not be empty").max(
      MAX_PROMPT_CHARS,
      `prompt must be at most ${MAX_PROMPT_CHARS} characters`,
    ),
    seed: z
      .object({
        kind: z.string().trim().max(64).optional(),
        id: z.string().trim().max(1_024).optional(),
        text: z.string().trim().max(MAX_SEED_TEXT_CHARS).optional(),
        zone: z.string().trim().max(256).optional(),
        files: z.array(z.string().trim().max(1_024)).max(MAX_SEED_FILES).optional(),
        labels: z.record(z.string().trim().max(256)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AskRequest = z.infer<typeof AskRequestSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** Named failure modes. Every non-200 response carries exactly one. */
export type AskErrorKind =
  | "invalid_request"
  | "no_analysis"
  | "timeout"
  | "rate_limit"
  | "auth"
  | "network"
  | "llm_error";

export interface AskSuccessResponse {
  /** The model's answer, as markdown. */
  answer: string;
  /** Vendor that served the call. */
  vendor: LLMVendor;
  /** Model that served the call. */
  model: string;
  /**
   * Token counts for this call. Zeros when the provider reported none (some
   * CLI providers do not) — never absent, so the usage rollup has a shape it
   * can always add up.
   */
  tokens: TokenUsage;
  /** Analysis artifacts the answer was grounded in, relative to `.sourcevision/`. */
  contextSources: string[];
}

export interface AskErrorResponse {
  error: string;
  kind: AskErrorKind;
  suggestion?: string;
  /** Vendor-supplied retry delay, when a rate limit named one. */
  retryAfterMs?: number;
}

export interface HandleSourcevisionAskOptions {
  /**
   * Override the LLM client factory (test injection). Production passes
   * nothing and gets `createLLMClient` from the foundation tier.
   */
  createClient?: (options: { vendor: LLMVendor; llmConfig: LLMConfig }) => LLMClient;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Resolve the Ask call budget in ms, 0 meaning "no timeout".
 *
 * Reads the shared config with the gitignored local overlay merged on top —
 * the same "local wins" precedence `loadLLMConfig` and `routes-llm.ts` apply,
 * so a per-machine override behaves here the way it does everywhere else.
 */
export function resolveAskTimeoutMs(projectDir: string): number {
  const shared = readJsonFile(join(projectDir, NDX_CONFIG));
  const local = readJsonFile(join(projectDir, NDX_LOCAL_CONFIG));
  const merged = Object.keys(local).length > 0 ? deepMerge(shared, local) : shared;

  const sourcevision = merged["sourcevision"];
  if (!sourcevision || typeof sourcevision !== "object") return DEFAULT_ASK_TIMEOUT_MS;
  const ask = (sourcevision as Record<string, unknown>)["ask"];
  if (!ask || typeof ask !== "object") return DEFAULT_ASK_TIMEOUT_MS;
  const timeoutMs = (ask as Record<string, unknown>)["timeoutMs"];
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return DEFAULT_ASK_TIMEOUT_MS;
  }
  return timeoutMs;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Extra rules that apply when the question is about one specific item.
 *
 * A seeded question ("explain this finding") has a failure mode a free-form
 * one does not: an answer that describes the *category* — what a god file is,
 * why coupling is bad — reads as competent and could have been written without
 * the analysis. These rules make the seeded item's own zone and files the
 * subject, and require the answer to say where a fix would land, which is the
 * part a reader cannot get from the finding row they already saw.
 */
const SEEDED_RULES = [
  "- The user is asking about the specific item under 'What the user is looking at'.",
  "  Make that item the subject: name its zone and its files explicitly, and",
  "  explain what it means for THIS repository rather than for its category.",
  "- Say what a fix would touch — which files and zones a change would land in,",
  "  and what else imports them. If the analysis does not show that, say so.",
  "- A generic explanation of the finding type is not an answer to this question.",
];

/**
 * Build the full prompt.
 *
 * The instruction block is emphatic about the analysis being the only source
 * because that is the endpoint's whole contract: the model has no file access
 * here, so an answer it invents from the project's name would be
 * indistinguishable from one the analysis supports.
 *
 * `seeded` adds {@link SEEDED_RULES}. It is a flag rather than the seed itself
 * because the seed's content is already in `context`; what changes here is
 * only what the model is asked to do with it.
 */
export function buildAskPrompt(question: string, context: string, seeded = false): string {
  return [
    "You are answering a question about a software project on behalf of the",
    "SourceVision dashboard. A static analysis of the project is provided below.",
    "",
    "Rules:",
    "- Answer ONLY from the analysis provided. You have no access to the source.",
    "- When the analysis does not cover what was asked, say so plainly and name",
    "  what would answer it (for example: re-run analysis with a deeper pass).",
    "- Cite the zone IDs, file paths, and findings you relied on.",
    "- Do not speculate about code you cannot see, and do not invent file paths.",
    "- Reply in markdown. Be concise.",
    ...(seeded ? SEEDED_RULES : []),
    "",
    "----- BEGIN ANALYSIS -----",
    context,
    "----- END ANALYSIS -----",
    "",
    "Question:",
    question,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

/**
 * Race the completion against the budget.
 *
 * `Promise.race` attaches handlers to both promises, so a provider rejection
 * arriving after the timer already won is still handled and cannot surface as
 * an unhandled rejection. `timeoutMs` is also passed to the provider so a
 * CLI-mode child bounds itself rather than outliving the response.
 *
 * `onLateResult` is called when the provider finishes *after* the timer already
 * rejected. Those tokens were genuinely spent, so the ledger wants them even
 * though no one is left to read the answer. The extra `then` needs its own
 * rejection handler: `Promise.race` handles the original promise, but this
 * derived one would otherwise report a post-timeout rejection as unhandled.
 */
async function completeWithTimeout(
  client: LLMClient,
  request: CompletionRequest,
  timeoutMs: number,
  onLateResult?: (result: CompletionResult) => void,
): Promise<CompletionResult> {
  if (timeoutMs <= 0) return await client.complete(request);

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inFlight = client.complete({ ...request, timeoutMs });
  inFlight.then(
    (result) => {
      if (timedOut) onLateResult?.(result);
    },
    () => {
      // Already surfaced through the race; nothing to account for.
    },
  );

  try {
    return await Promise.race([
      inFlight,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new ClaudeClientError(
              `Ask request timed out after ${Math.round(timeoutMs / 1000)}s.`,
              "timeout",
              true,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Map a category from the shared classifier onto a named Ask failure. */
const CATEGORY_TO_KIND: Record<string, AskErrorKind> = {
  "rate-limit": "rate_limit",
  auth: "auth",
  timeout: "timeout",
  network: "network",
};

const KIND_TO_STATUS: Record<AskErrorKind, number> = {
  invalid_request: 400,
  no_analysis: 404,
  timeout: 504,
  rate_limit: 429,
  auth: 401,
  network: 502,
  llm_error: 502,
};

/**
 * Classify a failed Ask call into a named kind plus user-facing wording.
 *
 * Providers that already threw a typed {@link ClaudeClientError} are trusted
 * over re-classification from the message: the provider knew it was a 429 or a
 * deadline, whereas the classifier can only pattern-match the text and would
 * downgrade a reason it cannot see to `unknown`.
 */
export function classifyAskFailure(
  err: unknown,
  vendor: LLMVendor,
  model: string,
): AskErrorResponse {
  const error = err instanceof Error ? err : new Error(String(err));
  const classification = classifyLLMError(error, vendor, { label: "ask SourceVision", model });

  let kind: AskErrorKind = CATEGORY_TO_KIND[classification.category] ?? "llm_error";
  if (error instanceof ClaudeClientError) {
    const fromReason = CATEGORY_TO_KIND[error.reason];
    if (fromReason) kind = fromReason;
  }

  const response: AskErrorResponse = {
    error: classification.message,
    kind,
    suggestion: classification.suggestion,
  };
  if (error instanceof ClaudeClientError && error.retryAfterMs != null) {
    response.retryAfterMs = error.retryAfterMs;
  }
  return response;
}

function sendError(res: ServerResponse, payload: AskErrorResponse): void {
  jsonResponse(res, KIND_TO_STATUS[payload.kind], payload);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function handleAsk(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: HandleSourcevisionAskOptions,
): Promise<void> {
  // Read, parse, and validate in separate blocks. A single try around all
  // three would let a throw from `sendError` — after the response headers are
  // already out — fall into the catch and attempt a second write.
  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    sendError(res, { error: "Could not read the request body.", kind: "invalid_request" });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    sendError(res, { error: "Request body must be JSON.", kind: "invalid_request" });
    return;
  }

  const validation = AskRequestSchema.safeParse(json);
  if (!validation.success) {
    sendError(res, {
      error: validation.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; "),
      kind: "invalid_request",
    });
    return;
  }
  const parsed: AskRequest = validation.data;

  const context = assembleAskContext(ctx, parsed.seed);
  if (!context.available) {
    sendError(res, {
      error: "No analysis data to answer from.",
      kind: "no_analysis",
      suggestion: `Run '${readCliName(ctx.projectDir)} analyze .' first, then ask again.`,
    });
    return;
  }

  const llmConfig = await loadLLMConfig(ctx.projectDir);
  const vendor: LLMVendor = llmConfig.vendor ?? DEFAULT_LLM_VENDOR;
  // The class name is written as a literal, not via a constant: the registry
  // contract test (tests/integration/task-class-registry.test.js) recognises a
  // declared class only from a string argument at the call site, so a constant
  // would hide this call from the check that the class exists in
  // DEFAULT_ROUTES. It resolves to the standard tier — the answer is prose a
  // person reads and acts on, which is exactly the work the registry keeps off
  // the light tier — and `llm.routes` reroutes it per project with no code
  // change.
  const { model } = resolveTaskModel("sourcevision.ask", llmConfig, { vendor });
  const timeoutMs = resolveAskTimeoutMs(ctx.projectDir);

  /**
   * Append one ledger record for this ask.
   *
   * `calls` is a parameter rather than always 1 because a provider that
   * finishes after the timeout adds a second record for the same call.
   */
  const record = (
    tokens: TokenUsage | undefined,
    outcome: DashboardUsageOutcome,
    calls: number,
  ): void => {
    recordDashboardUsage(ctx.projectDir, {
      timestamp: new Date().toISOString(),
      command: ASK_COMMAND,
      vendor,
      model,
      ...tokenFields(tokens),
      calls,
      outcome,
    });
  };

  let client: LLMClient;
  try {
    client = (opts.createClient ?? createLLMClient)({ vendor, llmConfig });
  } catch (err) {
    // Deliberately unrecorded: no call was made, so there is no spend. The
    // ledger counts calls, not intentions.
    sendError(res, classifyAskFailure(err, vendor, model));
    return;
  }

  try {
    const result = await completeWithTimeout(
      client,
      { prompt: buildAskPrompt(parsed.prompt, context.text, context.seeded), model },
      timeoutMs,
      (late) => record(late.tokenUsage, "timeout", 0),
    );
    const tokens: TokenUsage = result.tokenUsage ?? { input: 0, output: 0 };
    record(tokens, "success", 1);
    const payload: AskSuccessResponse = {
      answer: result.text,
      vendor,
      model,
      tokens,
      contextSources: context.sources,
    };
    jsonResponse(res, 200, payload);
  } catch (err) {
    const failure = classifyAskFailure(err, vendor, model);
    // A failed call is still a call. Providers surface failures as untyped
    // errors carrying no usage, so the counts are zero here — the record exists
    // so the failure is visible in the utilization view rather than absent from
    // it, and any counts the provider does report late are appended separately.
    record(undefined, failure.kind === "timeout" ? "timeout" : "error", 1);
    sendError(res, failure);
  }
}

/**
 * Handle `/api/sourcevision/ask`. Returns true when the request was handled.
 */
export async function handleSourcevisionAskRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  opts: HandleSourcevisionAskOptions = {},
): Promise<boolean> {
  const pathname = (req.url || "/").split("?")[0];
  if (pathname !== ASK_PATH) return false;

  if ((req.method || "GET") !== "POST") {
    jsonResponse(res, 405, { error: "Method not allowed. Use POST.", kind: "invalid_request" });
    return true;
  }

  await handleAsk(req, res, ctx, opts);
  return true;
}
