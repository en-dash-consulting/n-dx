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
import {
  BROKER_SCOPE_TOOLS,
  GITHUB_READS_SETTING,
  HUB_COMMAND_ARGV,
  hubCommandRefusal,
  SIDECAR_BROKER_NAME,
  type BrokerScope,
  type BrokerToolName,
} from "./broker-policy.js";
import { DRAFT_FILE_KINDS, DRAFT_FILE_MAX_CHARS, resolveDraftPath } from "./draft-file.js";
import type { CardAnnex, SidecarBroker } from "./broker.js";
import {
  carryOutDecision,
  GITHUB_POST_KINDS,
  GITHUB_READ_KINDS,
  githubReadOf,
  workOptions,
  type SidecarActions,
} from "./carry-out.js";
import { LEDGER_ENTRY_MAX_CHARS, type LedgerEntryType } from "./ledger.js";

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
        .describe("Run options as the dashboard's execute route takes them (model, review, maxTurns, requireUnblocked, …)"),
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
  propose_run_plan: {
    description: [
      "Propose the queue planner's run plan. Always waits for the operator's run-plan card, which lists each lane with its exact `ndx work` command as the planner printed it; you give no commands.",
      "The operator copies the commands or chooses Start lane; the result then names the lane's first task, for which you call start_work.",
      "Refused when the planner has no lane. Starts nothing.",
    ].join(" "),
    input: { note: z.string().optional().describe("One line on why this plan, shown on the card") },
  },
  place_change_card: {
    description: [
      "Propose placing a v2 change: on an existing capability or constraint (`target` with `relation`; for amends, `proposed` and/or `criteria`), or as a new capability or constraint under an area (`propose`).",
      "Always waits for the operator's placement card, which shows rex's dry run of the placement; a refusal names rex's kind.",
      "A proposed node is recorded on the change only and reaches the product map when the change is applied. Nothing is applied from a card.",
    ].join(" "),
    input: {
      change: z.string().min(1).describe("The change's id or display id"),
      target: z.string().min(1).optional().describe("A live capability or constraint id; omit when proposing"),
      relation: z.enum(["touches", "amends"]).optional().describe("Default: the rules' relation for the change"),
      summary: z.string().optional().describe("The amendment's summary; default the change's title"),
      proposed: z.string().optional().describe("amends: the target's full replacement statement"),
      criteria: z.object({
        add: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).optional(),
        replace: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).optional(),
        remove: z.array(z.string().min(1)).optional(),
      }).optional().describe("amends: the capability-criteria delta"),
      propose: z.object({
        type: z.enum(["capability", "constraint"]),
        under: z.string().min(1).describe("A live area id"),
        title: z.string().min(1),
        summary: z.string().optional(),
        proposed: z.string().optional().describe("The new node's statement"),
        criteria: z.object({ add: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })) }).optional()
          .describe("A capability's criteria; a constraint has none"),
      }).optional().describe("Instead of target: a new node, when nothing on the shortlist fits"),
      reasons: z.array(z.string().min(1)).min(1).describe("Why this placement, one line each, shown on the card"),
    },
  },
  propose_edit: {
    description: "Propose a source edit as a unified diff. Always waits for the operator's edit card.",
    input: { path: z.string().min(1), diff: z.string().min(1) },
  },
  github_read: {
    description: [
      "Read from GitHub with gh. `pr`: the PR of the worktree the workspace key `ref` names, its checks, each failing check's class and log tail.",
      "`check`: the newest run of the check named `ref` on branch `base`, which decides whether a failing check is failing on main.",
      "Runs at once while GitHub reads are on for this project (web.sidecarGithubReads); otherwise waits for the operator's network-read card.",
    ].join(" "),
    input: {
      kind: z.enum(GITHUB_READ_KINDS),
      ref: z.string().min(1).describe("pr: a workspace key; check: the check's name"),
      base: z.string().min(1).optional().describe("check: the branch to read the check on, e.g. the PR's base"),
    },
  },
  draft_github_post: {
    description: "Draft a PR comment (`comment`) or review comment (`review`) on `target` (a PR number, URL or branch). Always waits for the operator's draft card; it is posted under the operator's gh login only on Approve, and Copy or Discard posts nothing.",
    input: {
      kind: z.enum(GITHUB_POST_KINDS),
      // gh would read a leading "-" as a flag (`--repo=…` posts to another repository).
      target: z.string().regex(/^[^-\s]\S*$/, "a PR number, URL or branch, not a flag").describe("A PR number, URL or branch"),
      body: z.string().min(1),
    },
  },
  migration_decision: {
    description: "Record decisions for a v1 to v2 PRD migration. Always waits for the operator's migration-decision card.",
    input: { entries: objects },
  },
  save_draft: {
    description: "Hub session only.",
    input: {},
  },
};

const projectField = z.string().min(1).describe("The registered project's id, as the snapshot names it");

/**
 * The hub session's versions of the tools it shares with a worktree's, and its
 * own `save_draft`: every call names its project, and none acts.
 */
const HUB_CARD_TOOLS: Partial<Record<BrokerToolName, { description: string; input: z.ZodRawShape }>> = {
  run_command: {
    description: `Run one read-only command at a project's repository root: ${HUB_COMMAND_ARGV.map((argv) => "`" + argv.join(" ") + "`").join(", ")}. Any other command is refused with no card. Waits for the operator's command card unless that exact command is allow-listed for that project.`,
    input: { project: projectField, argv: z.array(z.string()).min(1).describe("One of the commands above, one token each") },
  },
  draft_github_post: {
    description: "Draft a PR comment (`comment`) or review comment (`review`) on `target` (a PR number, URL or branch) of `project`. Always waits for the operator's draft card naming the project and target; it is posted under the operator's gh login, with the project's repository root as its working directory, only on Approve. Copy or Discard posts nothing.",
    input: {
      project: projectField,
      kind: z.enum(GITHUB_POST_KINDS),
      target: z.string().regex(/^[^-\s]\S*$/, "a PR number, URL or branch, not a flag").describe("A PR number, URL or branch"),
      body: z.string().min(1),
    },
  },
  save_draft: {
    description: "Draft a file for the operator: a side-session prompt, a restack plan or a release checklist. Always waits for the operator's draft-file card, which shows the path and lets the operator change it; nothing is written before Approve, and an existing file is never overwritten. A relative path lands in the hub's drafts directory.",
    input: {
      kind: z.enum(DRAFT_FILE_KINDS),
      path: z.string().min(1).describe("Where to save it; the operator can change this on the card"),
      content: z.string().min(1).max(DRAFT_FILE_MAX_CHARS),
    },
  },
};

/** The tools a scope's session is offered that raise a card, each with its own input. */
function cardToolsFor(scope: BrokerScope): Array<[BrokerToolName, { description: string; input: z.ZodRawShape }]> {
  return BROKER_SCOPE_TOOLS[scope]
    .filter((name): name is Exclude<BrokerToolName, "ledger_append"> => name !== "ledger_append")
    .map((name) => [name, (scope === "hub" ? HUB_CARD_TOOLS[name] : undefined) ?? CARD_TOOLS[name]]);
}

/** A hub call's refusal before any card: its project must be one the hub names, and run_command a fixed read-only argv. */
async function hubCallRefusal(
  name: BrokerToolName,
  input: Record<string, unknown>,
  actions: SidecarActions | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  if (name === "run_command") {
    const refusal = hubCommandRefusal((input.argv as unknown[]).map(String));
    if (refusal) return refusal;
  }
  if (name === "save_draft") return null;
  if (!actions?.projectRepoRoot) return "this server cannot name the hub's projects";
  const root = await actions.projectRepoRoot(String(input.project), signal);
  return root.ok ? null : root.error;
}

function text(message: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: message }], ...(isError && { isError: true }) };
}

/**
 * The broker MCP server for one Sidecar session. `actions` carries out an
 * approved call (see `carry-out.ts`); without it an approved call that has
 * an effect reports that nothing ran.
 */
export function createBrokerMcpServer(
  broker: SidecarBroker,
  sessionId: string,
  actions?: SidecarActions,
  scope: BrokerScope = "worktree",
): McpServer {
  const server = new McpServer({ name: SIDECAR_BROKER_NAME, version: BROKER_VERSION });

  for (const [name, tool] of cardToolsFor(scope)) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, async (args, extra) => {
      let input = args as Record<string, unknown>;
      const annex: CardAnnex = {};
      if (scope === "hub") {
        // Refused here, so a call the hub never carries out raises no card for the operator to decide in vain.
        const refusal = await hubCallRefusal(name, input, actions, extra.signal);
        if (refusal) return text(`No card was raised: ${refusal}. Nothing ran.`, true);
        if (name === "save_draft") {
          // The card shows the absolute path the draft would land at.
          const resolved = resolveDraftPath(input.path, broker.draftsDir);
          if (!resolved.ok) return text(`No card was raised: ${resolved.error}. Nothing was saved.`, true);
          input = { ...input, path: resolved.path };
        }
      }
      // A work card shows what the run would be before the operator decides it, from the options start will use.
      if (name === "start_work") {
        annex.runOptions = workOptions(input);
        if (actions) annex.preview = await actions.previewWork(String(input.taskId), annex.runOptions);
      }
      // A change-set card shows its items read against the PRD; one that cannot be written raises no card.
      if (name === "propose_prd_change" && actions) {
        const changeSet = await actions.reviewChangeSet(input);
        if (typeof changeSet === "string") return text(`No card was raised: ${changeSet}. Nothing was written.`, true);
        annex.changeSet = changeSet;
      }
      // A placement card shows rex's dry run; a call naming no change, or unreadable, raises none.
      if (name === "place_change_card") {
        if (!actions) return text("No card was raised: this server cannot read the PRD. Nothing was written.", true);
        const placement = await actions.checkPlacement(input);
        if (typeof placement === "string") return text(`No card was raised: ${placement}. Nothing was written.`, true);
        annex.placement = placement;
      }
      // A run-plan card lists the planner's own lanes; with no plan, or no lane, no card is raised.
      if (name === "propose_run_plan") {
        if (!actions) return text("No card was raised: this server cannot read the queue planner. Nothing started.", true);
        const plan = await actions.readRunPlan(extra.signal);
        if (typeof plan === "string") return text(`No card was raised: ${plan}. Nothing started.`, true);
        if (plan.lanes.length === 0) return text(`No card was raised: the planner has no lane (${plan.summary}). Nothing started.`, true);
        annex.runPlan = plan;
      }
      if (name === "github_read") {
        // A read that cannot be carried out raises no card for the operator to approve in vain.
        const read = githubReadOf(input);
        if (typeof read === "string") return text(`No card was raised: ${read}. Nothing was read.`, true);
        // GitHub reads have one allowance, the project's setting: on, the read runs without a card.
        if (actions?.githubReadsAllowed()) {
          const allowed = { approved: true as const, decidedBy: "project-allowance" as const, setting: GITHUB_READS_SETTING };
          const result = await carryOutDecision(name, input, allowed, actions, extra.signal);
          return text(result.text, !result.ok);
        }
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
      // Only the types this scope's agent writes: a handoff is the hub's drill-down, never the agent's.
      inputSchema: {
        type: z.enum(broker.ledgerTypes as [LedgerEntryType, ...LedgerEntryType[]]),
        text: z.string().min(1).max(LEDGER_ENTRY_MAX_CHARS),
      },
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
  scope: BrokerScope = "worktree",
): Promise<void> {
  const server = createBrokerMcpServer(broker, sessionId, actions, scope);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
