/**
 * POST /api/sourcevision/ask — answer a question about the analyzed project.
 *
 * Request:  `{ prompt: string, seed?: string, finding?: AskFindingSeed }`
 * Response: `{ answer, vendor, model, tokens, sources }`
 *
 * `finding` is the structured form used by Explain on the Problems and
 * Suggestions surfaces — named fields, so what reaches the model is the finding
 * rather than someone's sentence about it. `seed` remains free text for callers
 * that have context but no finding.
 *
 * The answer is grounded in the `.sourcevision/` analysis rather than the
 * model's own impression of the codebase — see
 * {@link sourcevision-ask-context} for what is sent and why it is a digest.
 *
 * ## This is the web server's first in-process model call
 *
 * Every other heavy operation the server exposes is delegated: `/api/commands/*`
 * spawns a CLI and streams its output. This route blocks on a model instead,
 * which is why the failure handling below is more explicit than a typical route
 * needs. A spawned child that dies leaves an exit code to report; an in-process
 * call that stalls leaves the request hanging, so every classified failure
 * `@n-dx/llm-client` can raise is mapped to a distinct status and named in the
 * body. A caller has to be able to tell "you are rate limited" from "the model
 * timed out" from "you are not logged in" — they call for three different
 * actions, and a shared 500 would tell them none of it.
 *
 * ## No direct sourcevision import
 *
 * The analysis is read from disk (it is already-written output, not a
 * sourcevision API call), so this file imports nothing from
 * `@n-dx/sourcevision`. Anything it did need would go through
 * `domain-gateway.ts`, per the package's gateway rule.
 *
 * @module web/server/routes-sourcevision-ask
 * @see packages/web/src/server/domain-gateway.ts — the sourcevision gateway
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createLLMClient, loadLLMConfig, resolveVendorModel, ClaudeClientError } from "@n-dx/llm-client";
import type { LLMVendor } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import {
  createDigestContextSource,
  renderAskPrompt,
  NoAnalysisError,
} from "./sourcevision-ask-context.js";
import type { AskContextSource, AskFindingSeed } from "./sourcevision-ask-context.js";
import { recordAskUsage, askUsageCounters } from "./ask-usage-log.js";
import { noAnalysisFailure, askFailureForReason } from "./sourcevision-ask-diagnostics.js";
import { readCliName } from "./cli-name.js";

const ASK_PATH = "/api/sourcevision/ask";

/** How long to let a single answer take before giving up on it. */
const ASK_TIMEOUT_MS = 120_000;

/** Validated request body. */
interface AskRequest {
  prompt: string;
  seed?: string;
  finding?: AskFindingSeed;
}

/**
 * Validate the optional `finding`.
 *
 * A finding arrives as named fields rather than a sentence, so the fields are
 * checked rather than trusted: a `files` array holding numbers would otherwise
 * reach the prompt as `1, 2` and read to the model as filenames. Severity is
 * the only optional one — the analysis does not always classify a finding, and
 * defaulting it here would assert something it never said.
 *
 * @returns the finding, or a message naming what is wrong with it
 */
function parseFinding(raw: unknown): AskFindingSeed | { error: string } | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "`finding` must be an object when supplied." };
  }

  const { type, severity, zone, message, files } = raw as Record<string, unknown>;
  for (const [name, value] of [["type", type], ["zone", zone], ["message", message]] as const) {
    if (typeof value !== "string" || value.trim() === "") {
      return { error: `\`finding.${name}\` is required and must be a non-empty string.` };
    }
  }
  if (severity !== undefined && typeof severity !== "string") {
    return { error: "`finding.severity` must be a string when supplied." };
  }
  if (files !== undefined && (!Array.isArray(files) || files.some((f) => typeof f !== "string"))) {
    return { error: "`finding.files` must be an array of strings when supplied." };
  }

  return {
    type: type as string,
    ...(severity === undefined ? {} : { severity: severity as string }),
    zone: zone as string,
    message: message as string,
    files: (files as string[] | undefined) ?? [],
  };
}

/**
 * Validate the request body.
 *
 * @returns the parsed request, or a message naming what is wrong with it
 */
function parseAskRequest(raw: string): AskRequest | { error: string } {
  let input: unknown;
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return { error: "Request body is not valid JSON." };
  }
  if (!input || typeof input !== "object") {
    return { error: "Request body must be a JSON object." };
  }

  const { prompt, seed, finding } = input as Record<string, unknown>;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { error: "`prompt` is required and must be a non-empty string." };
  }
  if (seed !== undefined && typeof seed !== "string") {
    return { error: "`seed` must be a string when supplied." };
  }

  const parsedFinding = parseFinding(finding);
  if (parsedFinding && "error" in parsedFinding) return parsedFinding;

  return {
    prompt,
    ...(seed === undefined ? {} : { seed }),
    ...(parsedFinding === undefined ? {} : { finding: parsedFinding }),
  };
}

/**
 * HTTP status for each way a model call can fail.
 *
 * Deliberately distinct: these are the statuses a client would branch on.
 * `auth` is the operator's to fix, `rate-limit` is worth retrying later,
 * `timeout` may succeed on a smaller question, and `not-found` means the
 * configured CLI is not installed.
 */
const STATUS_BY_REASON: Record<string, number> = {
  auth: 401,
  "rate-limit": 429,
  timeout: 504,
  "not-found": 503,
  cli: 502,
  unknown: 502,
};

/** Human-facing prefix per reason, so the body says what happened. */
const MESSAGE_BY_REASON: Record<string, string> = {
  auth: "LLM authentication failed",
  "rate-limit": "LLM rate limit reached",
  timeout: "The model timed out",
  "not-found": "The configured LLM CLI was not found",
  cli: "The LLM call failed",
  unknown: "The LLM call failed",
};

/**
 * Handle the ask route.
 *
 * @param contextSource - injectable for tests and for a future lookup-driven
 *   source; defaults to the `CONTEXT.md` digest
 * @returns true when this route handled the request
 */
export async function handleSourcevisionAskRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  contextSource?: AskContextSource,
): Promise<boolean> {
  const url = req.url || "/";
  const routePath = url.split("?")[0];
  if (routePath !== ASK_PATH) return false;

  if ((req.method || "GET") !== "POST") {
    errorResponse(res, 405, "Method not allowed — use POST.");
    return true;
  }

  const parsed = parseAskRequest(await readBody(req));
  if ("error" in parsed) {
    errorResponse(res, 400, parsed.error);
    return true;
  }

  // Ground the answer before spending anything on a model call.
  const source = contextSource ?? createDigestContextSource(ctx.svDir);
  let context;
  try {
    context = await source.assemble(parsed);
  } catch (err) {
    if (err instanceof NoAnalysisError) {
      // Carries the same `error` string it always did, plus the structured
      // failure the panel needs to offer the analyze action rather than just
      // naming the command.
      jsonResponse(res, 409, {
        ok: false,
        reason: "no-analysis",
        error: err.message,
        failure: noAnalysisFailure(readCliName(ctx.projectDir)),
      });
      return true;
    }
    throw err;
  }

  // Vendor and model come from the project's own config, so the answer is
  // produced by whatever the operator selected — and both are reported back,
  // because an answer cannot be judged without knowing what produced it.
  const llmConfig = await loadLLMConfig(ctx.projectDir);
  const vendor = (llmConfig?.vendor ?? "claude") as LLMVendor;
  const model = resolveVendorModel(vendor, llmConfig);

  try {
    const client = createLLMClient({ llmConfig, vendor });
    const result = await client.complete({
      prompt: renderAskPrompt(context, parsed.prompt),
      model,
      timeoutMs: ASK_TIMEOUT_MS,
    });

    // Recorded before responding, so the spend is on disk even if the client
    // disconnects mid-response. Best-effort by design — see ask-usage-log.
    await recordAskUsage(ctx.svDir, {
      timestamp: new Date().toISOString(),
      vendor,
      model,
      ...askUsageCounters(result.tokenUsage),
      ok: true,
    });

    jsonResponse(res, 200, {
      ok: true,
      answer: result.text,
      vendor,
      model,
      tokens: result.tokenUsage ?? null,
      sources: context.sources,
    });
  } catch (err) {
    const reason = err instanceof ClaudeClientError ? err.reason : "unknown";
    const detail = err instanceof Error ? err.message : String(err);

    // A failed ask is still an ask: the prompt was sent and a timeout or a
    // mid-stream failure can burn the input tokens anyway. Recording it as a
    // call that spent whatever it spent keeps the rollup honest, where dropping
    // it would quietly under-report the bill. No provider attaches usage to a
    // thrown error today, so this reads defensively and lands on zeros — the
    // attempt is what is being recorded.
    await recordAskUsage(ctx.svDir, {
      timestamp: new Date().toISOString(),
      vendor,
      model,
      ...askUsageCounters((err as { tokenUsage?: Parameters<typeof askUsageCounters>[0] }).tokenUsage),
      ok: false,
      reason,
    });

    jsonResponse(res, STATUS_BY_REASON[reason] ?? 502, {
      ok: false,
      reason,
      error: `${MESSAGE_BY_REASON[reason] ?? "The LLM call failed"}: ${detail}`,
      vendor,
      model,
      // What the panel actually renders: what happened, what to do about it,
      // and whether asking again could work. `error` stays for callers that
      // only want a line of text.
      failure: askFailureForReason(reason, vendor, detail),
    });
  }

  return true;
}
