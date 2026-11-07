/**
 * The `ndx-sidecar` broker as an MCP server, served by the dashboard at
 * `/api/sidecar/sessions/:id/mcp` (Streamable HTTP).
 *
 * It runs inside the dashboard server so a card is a pending promise beside
 * the route that decides it, rather than a message between processes. The
 * transport is stateless (a server per request, JSON responses): a tool call
 * is one POST whose response waits until the card settles, and closing that
 * request (the CLI was stopped) withdraws the card.
 *
 * A worktree session also gets the tools of the servers the operator connected
 * (`../connections/`), under their wire names: a run-policy call goes straight
 * through, an ask-policy call waits on an external-call card. That is the only
 * way an external server reaches either vendor's session; see
 * docs/architecture/sidecar-connections.md.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ConnectionUnavailableError,
  parseConnectionWireName,
  type ConnectionService,
  type ConnectionState,
  type ConnectionTool,
} from "../connections/connection-service.js";
import { readBody } from "../response-utils.js";
import {
  BROKER_SCOPE_TOOLS,
  EXTERNAL_CALL_TOOL,
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
import { readChoiceCall } from "./choice-card.js";
import { buildExternalCall, callProblems } from "./external-call.js";
import { BRANCH_HEALTH_OFF_READ, CLASS_FAILING_ON_MAIN, classFailingOnBase } from "./github.js";
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
      "Propose PRD items to add. Always waits for the operator's change-set card, on which the operator can edit each item's title, description, done-when and tags before approving; the result lists the ids written.",
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
        tags: z.array(z.string()).optional().describe("Tags to put on the new item"),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        parentId: z.string().optional().describe("v1: an existing item to add under"),
        parent: z.number().int().min(0).optional().describe("v1: the index of an earlier item on this card to add under"),
      })).min(1),
      target: z.string().optional().describe("v2: the capability or constraint the change touches"),
    },
  },
  propose_run_plan: {
    description: [
      "Propose the queue planner's run plan. Always waits for the operator's run-plan card, which lists each track with its exact `ndx work` command as the planner printed it; you give no commands.",
      "The operator copies the commands or chooses Start track; the result then names the track's first task, for which you call start_work.",
      "Refused when the planner has no track. Starts nothing.",
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
  propose_link: {
    description: [
      "Propose linking a PRD item to a tracker work item. Always waits for the operator's link card, which shows the item and the ref; the ref is written only on Approve, and never allow-listed.",
      "`ref` is a tracker key (WM-2054) or the work item's http(s) URL. On a v2 PRD it is added to the item's issues, on a v1 PRD to its links.",
      "Refused with no card when the item does not exist, the ref is neither a key nor a URL, or the item already links to it.",
    ].join(" "),
    input: {
      itemId: z.string().min(1).describe("The change, task or subtask to link"),
      ref: z.string().min(1).describe("A tracker key or the tracker item's URL"),
    },
  },
  propose_item_edit: {
    description: [
      "Propose editing an existing PRD item: its title, description, done-when (acceptanceCriteria), tags or priority. Always waits for the operator's item-edit card, which shows each field before and after and lets the operator change the proposed values before approving; nothing is written before Approve, and never allow-listed.",
      "Give only the fields to change. acceptanceCriteria and tags replace the whole list, so send every entry the item should keep.",
      "Refused with no card when the item does not exist or already has the values. Status is not edited here.",
    ].join(" "),
    input: {
      id: z.string().min(1).describe("The change, task or subtask to edit (id or display id)"),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional().describe("Done-when for the item's own work; replaces the list"),
      tags: z.array(z.string()).optional().describe("Replaces the list"),
      priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    },
  },
  propose_status: {
    description: [
      "Propose changing an existing PRD item's status (what rex update_task_status does). Always waits for the operator's status card, which shows the current and proposed status and rex's own transition rule; nothing is written before Approve, and never allow-listed.",
      "Approval runs rex's own path, never forced: a move rex refuses (for example completed to pending) comes back as an error with rex's message, and completing an item runs rex's checks.",
      "Refused with no card when the item does not exist or already has the status. Fields other than status are edited with propose_item_edit.",
    ].join(" "),
    input: {
      id: z.string().min(1).describe("The change, task or subtask (id or display id)"),
      status: z.enum(["pending", "in_progress", "completed", "failing", "deferred", "blocked", "cancelled", "deleted"]).describe("The proposed status"),
      reason: z.string().optional().describe("Why the status changes; shown on the card, and the failure reason when status is failing"),
    },
  },
  ask_choice: {
    description: [
      "Ask the operator to decide between options you name; use it instead of writing \"A, B or C\" in your reply. Waits for the operator's choice card and returns their answer as the result.",
      "Give two to twelve options, each a short `label` and an optional `description`. The card always offers an Other row for free text, so do not add one. Set `multiSelect` only when more than one answer can stand.",
      "It writes nothing; a denied card means the operator declined to answer.",
    ].join(" "),
    input: {
      question: z.string().min(1).describe("The decision, as one question"),
      options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).min(2).max(12),
      multiSelect: z.boolean().optional().describe("Let the operator pick several options"),
    },
  },
  github_read: {
    description: [
      "Read from GitHub with gh. `pr`: the PR of the worktree the workspace key `ref` names, its checks, each failing check's class and log tail; it reads nothing while the git.branchHealth feature is off.",
      `\`check\`: the newest run of the check named \`ref\` on branch \`base\`, which decides whether a failing check is ${CLASS_FAILING_ON_MAIN} (\`base\` is the repository's default branch) or ${classFailingOnBase("<base>")} (any other base).`,
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

/** The connection gateway as the broker uses it. */
export type BrokerConnections = Pick<ConnectionService, "hasConnections" | "listTools" | "check" | "callTool" | "callContext">;

/** The external tools one broker server re-exposes, and the gateway that carries out their calls. */
export interface BrokerExternalTools {
  tools: readonly ConnectionTool[];
  connections: BrokerConnections;
}

/**
 * An input schema the broker accepts any object under, whose tools/list JSON
 * Schema is the external server's own: validation stays with that server. An
 * `id` key is left out because zod reads it as a definition id, not schema.
 */
function externalInputSchema(schema: Tool["inputSchema"]): z.ZodType<Record<string, unknown>> {
  const json = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "id"));
  return z.looseObject({}).meta(json);
}

/** Why a connection that is not connected cannot carry out a call; the session reads it and keeps working. */
function unavailableText(tool: ConnectionTool, status: Exclude<ConnectionState, { state: "connected" }>): CallToolResult {
  return text(
    status.state === "needs-sign-in"
      ? `sign in again: connection ${tool.connection} needs sign-in (${status.reason}). ${tool.displayName} did not run.`
      : `connection unavailable: ${status.reason}. ${tool.displayName} did not run.`,
    true,
  );
}

/** Register a worktree session's external tools: every tool whose policy is not `never`, under its wire name. */
function registerExternalTools(
  server: McpServer,
  broker: SidecarBroker,
  sessionId: string,
  external: BrokerExternalTools,
): void {
  const { connections } = external;
  for (const tool of external.tools) {
    if (tool.policy.policy === "never") continue;
    server.registerTool(
      tool.wireName,
      {
        description: tool.description ? `${tool.displayName}: ${tool.description}` : tool.displayName,
        inputSchema: externalInputSchema(tool.inputSchema),
        ...(tool.annotations && { annotations: tool.annotations }),
      },
      async (args, extra) => {
        // What the call is made with: the agent's arguments, or the operator's edit of them on the card.
        let input = args as Record<string, unknown>;
        let cardId: string | undefined;
        if (tool.policy.policy === "ask") {
          // A connection that cannot carry the call out raises no card for the operator to approve in vain.
          const status = await connections.check(tool.connection, extra.signal);
          if (status.state !== "connected") return unavailableText(tool, status);
          const externalCall = await buildExternalCall(tool, external.tools, connections, extra.signal);
          const outcome = await broker.request(sessionId, EXTERNAL_CALL_TOOL, {
            connection: tool.connection,
            tool: tool.displayName,
            class: tool.policy.class,
            arguments: input,
          }, extra.signal, { externalCall });
          if (outcome.decidedBy === "allow-list") throw new Error("An external call is never allow-listed");
          const { card } = outcome;
          const note = card.reason ? ` Operator's note: ${card.reason}` : "";
          if (outcome.decidedBy === "withdrawn") {
            return text(`Card ${card.id} was withdrawn: ${card.reason ?? "the turn stopped"}. ${tool.displayName} did not run.`, true);
          }
          if (!outcome.approved) return text(`The operator denied card ${card.id}. ${tool.displayName} did not run.${note}`, true);
          cardId = card.id;
          // The approval carries the operator's edit; the card's input is what was approved.
          input = card.input.arguments as Record<string, unknown>;
        }
        // A stopped turn ends the wait on the external server, as it does a command's.
        const carrying = broker.carryOutSignal(sessionId, extra.signal);
        try {
          // The server's own result, isError included, goes back unchanged.
          const result = await connections.callTool(tool.connection, tool.tool, input, carrying.signal);
          if (cardId) {
            // The card shows a validation error's problems; nothing retries with altered arguments.
            const problems = callProblems(result);
            broker.recordCarriedOut(sessionId, cardId, { ok: !result.isError, ...(problems.length > 0 && { problems }) });
          }
          return result;
        } catch (err) {
          // An unreachable server, a stopped turn's abort or any other throw: the card reads failed, never still running.
          if (cardId) broker.recordCarriedOut(sessionId, cardId, { ok: false });
          if (!(err instanceof ConnectionUnavailableError)) throw err;
          return unavailableText(tool, err.status);
        } finally {
          carrying.release();
        }
      },
    );
  }
}

/**
 * The broker MCP server for one Sidecar session. `actions` carries out an
 * approved call (see `carry-out.ts`); without it an approved call that has
 * an effect reports that nothing ran. `external` are the connections' tools a
 * worktree session is offered; a hub session is offered none.
 */
export function createBrokerMcpServer(
  broker: SidecarBroker,
  sessionId: string,
  actions?: SidecarActions,
  scope: BrokerScope = "worktree",
  external?: BrokerExternalTools,
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
        const rowText = actions?.describeWork?.(String(input.taskId));
        if (rowText) annex.rowText = rowText;
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
      // A link card shows the item and ref read against the PRD; a call that cannot be written raises none.
      if (name === "propose_link") {
        if (!actions) return text("No card was raised: this server cannot read the PRD. Nothing was written.", true);
        const link = await actions.checkLink(input);
        if (typeof link === "string") return text(`No card was raised: ${link}. Nothing was written.`, true);
        annex.link = link;
      }
      // An item-edit card shows each field read against the PRD; a call that changes nothing, or names no item, raises none.
      if (name === "propose_item_edit") {
        if (!actions) return text("No card was raised: this server cannot read the PRD. Nothing was written.", true);
        const itemEdit = await actions.checkItemEdit(input);
        if (typeof itemEdit === "string") return text(`No card was raised: ${itemEdit}. Nothing was written.`, true);
        annex.itemEdit = itemEdit;
      }
      // A status card shows the item's status read against the PRD; an unknown item or an unchanged status raises none.
      if (name === "propose_status") {
        if (!actions) return text("No card was raised: this server cannot read the PRD. Nothing was written.", true);
        const statusChange = await actions.checkStatus(input);
        if (typeof statusChange === "string") return text(`No card was raised: ${statusChange}. Nothing was written.`, true);
        annex.statusChange = statusChange;
      }
      // A choice card shows the question as read; a call with no real choice raises none.
      if (name === "ask_choice") {
        const choice = readChoiceCall(input);
        if (typeof choice === "string") return text(`No card was raised: ${choice}. Nothing was asked.`, true);
        annex.choice = choice;
      }
      // A run-plan card lists the planner's own lanes; with no plan, or no lane, no card is raised.
      if (name === "propose_run_plan") {
        if (!actions) return text("No card was raised: this server cannot read the queue planner. Nothing started.", true);
        const plan = await actions.readRunPlan(extra.signal);
        if (typeof plan === "string") return text(`No card was raised: ${plan}. Nothing started.`, true);
        if (plan.lanes.length === 0) return text(`No card was raised: the planner has no track (${plan.summary}). Nothing started.`, true);
        annex.runPlan = plan;
      }
      if (name === "github_read") {
        // A read that cannot be carried out raises no card for the operator to approve in vain.
        const read = githubReadOf(input);
        if (typeof read === "string") return text(`No card was raised: ${read}. Nothing was read.`, true);
        // Branch health is off: the read would be refused, so the operator is not asked to approve it.
        if (read.kind === "pr" && actions && !actions.branchHealthEnabled()) return text(BRANCH_HEALTH_OFF_READ, true);
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
          const { card } = outcome;
          broker.recordCarriedOut(sessionId, card.id, { ok: result.ok, ...(result.ids && { ids: result.ids }), ...(result.held && { held: true }) });
          // A run that started can still fail; its card then reads failed, a run-plan lane open again,
          // and the session's next turn tells the agent, whose tool result said it started.
          void result.ended?.then((end) => { if (!end.ok) broker.reviseCarriedOutFailed(sessionId, card.id, end.text); });
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

  // After the broker's own tools; a wire name holds "__", which none of theirs does.
  if (external && scope === "worktree") registerExternalTools(server, broker, sessionId, external);

  return server;
}

/**
 * Which connections a JSON-RPC body needs read: every one for a tools/list,
 * else the ones its external calls name; `null` when it needs none.
 */
function connectionsNeeded(body: unknown): "all" | string[] | null {
  const named = new Set<string>();
  for (const message of Array.isArray(body) ? body : [body]) {
    if (!message || typeof message !== "object") continue;
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    if (method === "tools/list") return "all";
    const wire = method === "tools/call" && typeof params?.name === "string" ? parseConnectionWireName(params.name) : undefined;
    if (wire) named.add(wire.connection);
  }
  return named.size > 0 ? [...named] : null;
}

/**
 * Serve one broker MCP request for `sessionId`. With `connections` declared,
 * a worktree session's tools/list and external calls read their tools first;
 * every other request is served without touching a connection, so a slow or
 * missing server never holds up the broker's own tools.
 */
export async function handleBrokerMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  broker: SidecarBroker,
  sessionId: string,
  actions?: SidecarActions,
  scope: BrokerScope = "worktree",
  connections?: BrokerConnections,
): Promise<void> {
  let parsedBody: unknown;
  let external: BrokerExternalTools | undefined;
  if (scope === "worktree" && connections?.hasConnections() && req.method === "POST") {
    // Read here to see what the request asks; the transport is handed the body. readBody has
    // answered 413 to a body over the cap; any other failure is a broken request stream.
    let raw: string;
    try {
      raw = await readBody(req, res);
    } catch {
      if (!res.writableEnded) res.destroy();
      return;
    }
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      // Not JSON: the transport answers its own parse error for it.
      parsedBody = raw;
    }
    const needed = connectionsNeeded(parsedBody);
    if (needed) external = { tools: await connections.listTools(needed === "all" ? undefined : needed), connections };
  }
  const server = createBrokerMcpServer(broker, sessionId, actions, scope, external);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
