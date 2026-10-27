/**
 * The `ndx-sidecar` broker as an MCP server, served by the dashboard at
 * `/api/sidecar/sessions/:id/mcp` (Streamable HTTP).
 *
 * It runs inside the dashboard server so a card is a pending promise beside
 * the route that decides it, rather than a message between processes. The
 * transport is stateless (a server per request, JSON responses): a tool call
 * is one POST whose response waits until the card settles, and closing that
 * request (the CLI was stopped) withdraws the card.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SIDECAR_BROKER_NAME, type BrokerToolName } from "./broker-policy.js";
import { LEDGER_ENTRY_MAX_CHARS, LEDGER_ENTRY_TYPES, type SidecarBroker } from "./broker.js";

const BROKER_VERSION = "1.0.0";

const objects = z.array(z.record(z.string(), z.unknown())).min(1);

/** Input shape and description of each tool that raises a card. */
const CARD_TOOLS: Record<Exclude<BrokerToolName, "ledger_append">, { description: string; input: z.ZodRawShape }> = {
  run_command: {
    description: "Run an ndx or git command. Waits for the operator's command card unless the exact command is allow-listed.",
    input: { argv: z.array(z.string()).min(1).describe("The command and its arguments, one token each") },
  },
  start_work: {
    description: "Propose starting `ndx work` on a task. Always waits for the operator's work card.",
    input: { taskId: z.string().min(1), flags: z.array(z.string()).optional() },
  },
  propose_prd_change: {
    description: "Propose PRD items to add or change. Always waits for the operator's change-set card.",
    input: { items: objects },
  },
  place_change_card: {
    description: "Propose placing a change on a capability or constraint. Always waits for the operator's placement card.",
    input: { change: z.string().min(1), target: z.string().min(1), relation: z.string().min(1), amendment: z.string().optional() },
  },
  propose_edit: {
    description: "Propose a source edit as a unified diff. Always waits for the operator's edit card.",
    input: { path: z.string().min(1), diff: z.string().min(1) },
  },
  github_read: {
    description: "Read from GitHub (an issue, pull request, review or check). Waits for a network-read card unless GitHub reads are allow-listed.",
    input: { kind: z.string().min(1), ref: z.string().min(1) },
  },
  draft_github_post: {
    description: "Draft a GitHub comment, review or issue. It is posted only if the operator approves the draft card.",
    input: { kind: z.string().min(1), target: z.string().min(1), body: z.string().min(1) },
  },
  migration_decision: {
    description: "Record decisions for a v1 to v2 PRD migration. Always waits for the operator's migration-decision card.",
    input: { entries: objects },
  },
};

function text(message: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: message }], ...(isError && { isError: true }) };
}

/** The broker MCP server for one Sidecar session. */
export function createBrokerMcpServer(broker: SidecarBroker, sessionId: string): McpServer {
  const server = new McpServer({ name: SIDECAR_BROKER_NAME, version: BROKER_VERSION });

  for (const [name, tool] of Object.entries(CARD_TOOLS) as Array<[keyof typeof CARD_TOOLS, (typeof CARD_TOOLS)[keyof typeof CARD_TOOLS]]>) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, async (args, extra) => {
      const outcome = await broker.request(sessionId, name, args as Record<string, unknown>, extra.signal);
      if (outcome.decidedBy === "allow-list") {
        return text(`Allowed by the Sidecar allow-list. The dashboard carries out ${name} calls; nothing has run yet.`);
      }
      const { card } = outcome;
      const note = card.reason ? ` Operator's note: ${card.reason}` : "";
      if (outcome.decidedBy === "withdrawn") return text(`Card ${card.id} was withdrawn: ${card.reason ?? "the turn stopped"}.`, true);
      if (!outcome.approved) return text(`The operator denied card ${card.id}.${note}`, true);
      return text(`The operator approved card ${card.id}. The dashboard carries out ${name} calls; nothing has run yet.${note}`);
    });
  }

  server.registerTool(
    "ledger_append",
    {
      description: `Append a typed note to this session's ledger, carried over when the session's context is refreshed. At most ${LEDGER_ENTRY_MAX_CHARS} characters. Raises no card.`,
      inputSchema: { type: z.enum(LEDGER_ENTRY_TYPES), text: z.string().min(1).max(LEDGER_ENTRY_MAX_CHARS) },
    },
    async ({ type, text: note }) => {
      broker.appendLedger(sessionId, type, note);
      return text("Noted in the session ledger.");
    },
  );

  return server;
}

/** Serve one broker MCP request for `sessionId`. */
export async function handleBrokerMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  broker: SidecarBroker,
  sessionId: string,
): Promise<void> {
  const server = createBrokerMcpServer(broker, sessionId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
