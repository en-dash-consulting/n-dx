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
import type { CardAnnex, SidecarBroker } from "./broker.js";
import { carryOutDecision, workOptions, type SidecarActions } from "./carry-out.js";
import { LEDGER_ENTRY_MAX_CHARS, LEDGER_ENTRY_TYPES } from "./ledger.js";

const BROKER_VERSION = "1.0.0";

const objects = z.array(z.record(z.string(), z.unknown())).min(1);

/** Input shape and description of each tool that raises a card. */
const CARD_TOOLS: Record<Exclude<BrokerToolName, "ledger_append">, { description: string; input: z.ZodRawShape }> = {
  run_command: {
    description: "Run an ndx or git command. Waits for the operator's command card unless the exact command is allow-listed.",
    input: { argv: z.array(z.string()).min(1).describe("The command and its arguments, one token each") },
  },
  start_work: {
    description: "Propose starting `ndx work` on a task. Always waits for the operator's work card, which shows the run's `ndx work --resolve` settings.",
    input: {
      taskId: z.string().min(1),
      options: z.record(z.string(), z.unknown()).optional()
        .describe("Run options as the dashboard's execute route takes them (model, review, maxTurns, …)"),
    },
  },
  propose_prd_change: {
    description: [
      "Propose PRD items to add. Always waits for the operator's change-set card, on which the operator can edit each item's title, description and done-when before approving; the result lists the ids written.",
      "On a v2 PRD (product/ and changes/): item 1 is one change and every later item is one of its tasks; give `target` (a capability or constraint id) to place the change, or omit it and the change lands in the Inbox awaiting placement.",
      "On a v1 PRD: each item is added as add_item adds it, at the root or under `parentId` (an existing item) or `parent` (the index of an earlier item on this card); `type` defaults to the parent's child type.",
      "Nothing is applied: a change is never applied from a card.",
    ].join(" "),
    input: {
      items: z.array(z.object({
        title: z.string().min(1),
        type: z.string().optional().describe("v1: epic, feature, task or subtask; v2: change (item 1) or task"),
        description: z.string().optional(),
        acceptanceCriteria: z.array(z.string()).optional().describe("Done-when: what must be true for the item to be complete"),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        parentId: z.string().optional().describe("v1: an existing item to add under"),
        parent: z.number().int().min(0).optional().describe("v1: the index of an earlier item on this card to add under"),
      })).min(1),
      target: z.string().optional().describe("v2: the capability or constraint the change touches"),
    },
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

/**
 * The broker MCP server for one Sidecar session. `actions` carries out an
 * approved call (see `carry-out.ts`); without it an approved call that has
 * an effect reports that nothing ran.
 */
export function createBrokerMcpServer(broker: SidecarBroker, sessionId: string, actions?: SidecarActions): McpServer {
  const server = new McpServer({ name: SIDECAR_BROKER_NAME, version: BROKER_VERSION });

  for (const [name, tool] of Object.entries(CARD_TOOLS) as Array<[keyof typeof CARD_TOOLS, (typeof CARD_TOOLS)[keyof typeof CARD_TOOLS]]>) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, async (args, extra) => {
      const input = args as Record<string, unknown>;
      const annex: CardAnnex = {};
      // A work card shows what the run would be before the operator decides it.
      if (name === "start_work" && actions) annex.preview = await actions.previewWork(String(input.taskId), workOptions(input));
      // A change-set card shows its items read against the PRD; one that cannot be written raises no card.
      if (name === "propose_prd_change" && actions) {
        const changeSet = await actions.reviewChangeSet(input);
        if (typeof changeSet === "string") return text(`No card was raised: ${changeSet}. Nothing was written.`, true);
        annex.changeSet = changeSet;
      }
      const outcome = await broker.request(sessionId, name, input, extra.signal, annex);
      // A stopped turn ends the wait on an effect (a command), never the effect itself.
      const carrying = broker.carryOutSignal(sessionId, extra.signal);
      try {
        const result = await carryOutDecision(name, input, outcome, actions, carrying.signal);
        if (outcome.decidedBy !== "allow-list" && outcome.approved) {
          broker.recordCarriedOut(sessionId, outcome.card.id, { ok: result.ok, ...(result.ids && { ids: result.ids }) });
        }
        return text(result.text, !result.ok);
      } finally {
        carrying.release();
      }
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
  actions?: SidecarActions,
): Promise<void> {
  const server = createBrokerMcpServer(broker, sessionId, actions);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
