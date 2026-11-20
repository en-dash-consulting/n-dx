/**
 * Agent prompt file API routes.
 *
 * The project's agent prompt file (`.ndx/agent-prompt.md`, or wherever
 * `agent.promptFile` points inside the project) holds operator instructions
 * appended to the system prompt of every n-dx agent process — hench runs and
 * the Sidecar. `@n-dx/llm-client` owns the location, the path-escape refusal
 * and the size cap; this route only serves and saves the file.
 *
 * GET /api/agent-prompt — { path, content, exists, bytes, maxBytes, truncated, configured, warnings }
 * PUT /api/agent-prompt — body { content }; answers the GET shape as written
 *
 * Workspace-scoped like every settings write: `ctx.projectDir` is whichever
 * workspace the request addressed. The file is Markdown, not a config file, so
 * fail-forward's settings commit (which inspects JSON) does not apply to it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { AGENT_PROMPT_MAX_BYTES, readAgentPrompt, writeAgentPrompt } from "@n-dx/llm-client";
import type { AgentPrompt } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { errorMessage, errorResponse, jsonResponse, readJsonObject } from "./response-utils.js";

/** The shape GET and PUT /api/agent-prompt answer with. */
export interface AgentPromptResponse {
  /** The file, relative to the project root (forward slashes). */
  path: string;
  /** The file's text as agents receive it (capped at `maxBytes`). */
  content: string;
  exists: boolean;
  /** The file's full size in bytes. */
  bytes: number;
  /** Most bytes agents receive. */
  maxBytes: number;
  /** Whether `content` is shorter than the file. */
  truncated: boolean;
  /** Whether `agent.promptFile` chose the path. */
  configured: boolean;
  /** A refused `agent.promptFile`, truncation, an unreadable file. */
  warnings: string[];
}

const AGENT_PROMPT_PATH = "/api/agent-prompt";

function toResponse(prompt: AgentPrompt): AgentPromptResponse {
  return {
    path: prompt.relativePath,
    content: prompt.content,
    exists: prompt.exists,
    bytes: prompt.bytes,
    maxBytes: AGENT_PROMPT_MAX_BYTES,
    truncated: prompt.truncated,
    configured: prompt.configured,
    warnings: prompt.warnings,
  };
}

export async function handleAgentPromptRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const url = (req.url || "/").split("?")[0];
  if (url !== AGENT_PROMPT_PATH) return false;
  const method = req.method || "GET";

  if (method === "GET") {
    jsonResponse(res, 200, toResponse(readAgentPrompt(ctx.projectDir)));
    return true;
  }

  if (method === "PUT") {
    const body = await readJsonObject(req, res);
    if (typeof body === "string") {
      errorResponse(res, 400, body);
      return true;
    }
    if (typeof body.content !== "string") {
      errorResponse(res, 400, "content must be a string");
      return true;
    }
    try {
      jsonResponse(res, 200, toResponse(writeAgentPrompt(ctx.projectDir, body.content)));
    } catch (err) {
      // Over the cap, or a location outside the project: the operator's input, not a server fault.
      errorResponse(res, 400, errorMessage(err));
    }
    return true;
  }

  errorResponse(res, 405, "Method not allowed");
  return true;
}
