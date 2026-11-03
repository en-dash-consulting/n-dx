/**
 * Sidecar session routes: create a session, post a turn, read its frames.
 *
 * A turn is a POST that answers `202` as soon as the prompt is in the
 * transcript; the vendor CLI runs on in the background. Every frame the turn
 * appends is announced over the WebSocket as `sidecar:frames` with the
 * session's new cursor, and the client fetches `GET …/frames?after=<cursor>`
 * for the frames themselves — the announce-then-fetch pattern the run tail
 * uses (`hench:run-appended` + `/events?after=`). The socket carries no
 * transcript text, and a reloaded client resumes by fetching after the last
 * cursor it rendered.
 *
 * Routes, all under `/api/sidecar/sessions`, all refused while `web.sidecar`
 * is off (see route-feature-gates.ts):
 *
 * | Method | Path | Does |
 * |--------|------|------|
 * | GET  | `/api/sidecar/sessions` | sessions in this worktree |
 * | GET | `/api/sidecar/lenses` | the lens registry: each lens id, whether it can run, what it waits on |
 * | POST | `/api/sidecar/sessions` | create one (`{ vendor, model?, name?, lens?, target? }`) |
 * | GET  | `/api/sidecar/sessions/:id` | one session and whether a turn runs |
 * | PATCH | `/api/sidecar/sessions/:id` | rename, re-lens or re-target (`{ name?, lens?, target? }`) |
 * | POST | `/api/sidecar/sessions/:id/turns` | start a turn (`{ prompt }`) |
 * | GET  | `/api/sidecar/sessions/:id/frames?after=N` | transcript frames after N |
 * | POST | `/api/sidecar/sessions/:id/interrupt` | stop the running turn |
 * | POST | `/api/sidecar/sessions/:id/end` | end the session |
 * | GET  | `/api/sidecar/sessions/:id/cards` | the session's permission cards |
 * | POST | `/api/sidecar/sessions/:id/cards/:cardId` | decide a card (`{ decision: "approve" \| "deny", reason?, remember?, edits?, lane? }`; `edits` only on a change-set approval; `lane`, the 0-based lane to start, only on a run-plan approval and required there) |
 * | GET  | `/api/sidecar/proposals` | change-set cards whose items are not in the PRD yet (the Plan tree's ghost rows) |
 * | POST | `/api/sidecar/sessions/:id/mcp` | the `ndx-sidecar` broker (MCP, Streamable HTTP), while a turn runs |
 * | GET  | `/api/sidecar/allow-list` | the Sidecar allow-list |
 * | POST | `/api/sidecar/allow-list` | add a rule (`{ tool, argv }`); refused for work, reset, push and every never-allow-listed tool; `?dryRun=1` gives the same verdict and writes nothing |
 * | DELETE | `/api/sidecar/allow-list` | revoke a rule (`{ tool, key }`) |
 * | GET  | `/api/sidecar/settings` | mode, context ceilings, idle window, GitHub reads (`sidecar/settings.ts`) |
 * | PUT  | `/api/sidecar/settings` | save them; `null` resets a value, an invalid one answers 400 and writes nothing |
 *
 * **The hub session** has the same session routes under
 * `/api/sidecar/hub/sessions`, which the hub serves at `/hub/session/sessions`
 * (`GET`/`POST` the collection, then `:id`, `turns`, `frames`, `interrupt`,
 * `end`, `cards`, `mcp` as above). There is one per machine, under
 * `<ndx home>/hub/sidecar/`; this server serves it only while it holds the
 * host lock (`hub/session-host.ts`). A create on Codex is refused, a second
 * create answers the open session, and it keeps the hub lens, whose packet is
 * the hub snapshot rebuilt every turn. Its broker carries out nothing
 * ({@link hubSidecarActions}).
 *
 * Sessions are the addressed workspace's: `ctx.projectDir` picks the registry
 * and broker (`<henchDir>/sidecar/`) and is the worktree a new session runs in.
 *
 * Every side effect a session can cause goes through its broker (see
 * `sidecar/broker.ts`): a raised or settled card is announced as
 * `sidecar:card`, and the client fetches `…/cards`. The session's vendor CLI
 * reaches the broker at this server's own loopback port, with the dashboard
 * token and the workspace in headers (`sidecar/spawn-policy.ts`). An approved
 * call is carried out by {@link sidecarActions} (`sidecar/carry-out.ts`).
 *
 * @module web/server/routes-sidecar
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { exec as llmExec, isAuthError, redactSecrets, vendorSessionDriver } from "@n-dx/llm-client";
import type { SessionTurnStatus } from "@n-dx/llm-client";
import { SIDECAR_COMMAND, recordDashboardUsage, tokenFields } from "./dashboard-usage.js";
import { estimateCostFromTotals, type CostEstimate } from "./rex-gateway.js";
import type { ServerContext } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { errorMessage, errorResponse, jsonResponse, readBody } from "./response-utils.js";
import { SIDECAR_BROKER_KEY_HEADER, sidecarBrokerCredential } from "./sidecar/broker-credential.js";
import { handleBrokerMcpRequest } from "./sidecar/broker-mcp.js";
import { isBrokerTool } from "./sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard, type SidecarCardStatus } from "./sidecar/broker.js";
import { awaitSidecarCommand, renderWorkPreview, SIDECAR_COMMAND_WAIT_MS, type SidecarActions } from "./sidecar/carry-out.js";
import { reviewChangeSet, writeChangeSet } from "./sidecar/change-set.js";
import { startSidecarCommand } from "./routes-commands.js";
import { openTaskBlockers, readQueuePlan, repositoryRunSlotUsage, startTaskExecution } from "./routes-hench.js";
import { isFeatureEnabled } from "./routes-features.js";
import { diagnoseTaskRun, previewTaskRun, resolveTaskRun } from "./routes-hench-prep.js";
import { readDiagnosis } from "./run-diagnosis.js";
import { resolveContextCeiling } from "./sidecar/context-refresh.js";
import { readSidecarSettings, resolveSidecarIdleMs, saveSidecarSettings } from "./sidecar/settings.js";
import { commitSettingsChange } from "./settings-commit.js";
import { readLedger } from "./sidecar/ledger.js";
import { buildLensPacket, HUB_SCOPE_NEEDS, LENS_IDS, LENS_PACKETS, type LensTarget } from "./sidecar/lens-packets.js";
import type { PacketTarget } from "./sidecar/packet-builders.js";
import { createPacketSources, readResolution, type BranchHealthRead, type PacketSources, type SpawnedReads } from "./sidecar/packet-sources.js";
import { githubFactsBody } from "./sidecar/branch-packet.js";
import { baseCheckResult, postGithubDraft, readCheckOnBase } from "./sidecar/github.js";
import { collectProjectBranchHealth } from "./routes-branch-health.js";
import { NotAGitBranchError, type BranchHealthExec } from "./branch-health/index.js";
import {
  createHubSidecarRegistry,
  createWorktreeSidecarRegistry,
  SidecarSessionRegistry,
  worktreeSidecarDir,
  type SidecarContextOptions,
  type SidecarFrame,
  type SidecarRegistryOptions,
  type SidecarSessionRecord,
  type SidecarTurnOutcome,
} from "./sidecar/session-registry.js";
import { hubVendorRefusal, type SidecarBrokerEndpoint } from "./sidecar/spawn-policy.js";
import { hubSnapshotReader } from "./sidecar/hub-packet.js";
import { WORKSPACE_HEADER } from "./workspaces.js";
import { HUB_SIDECAR_API_PREFIX, SIDECAR_SESSION_ENDED_REASON } from "../shared/index.js";
import { claimHubSessionHost, hubSidecarDir, resolveHubHome } from "../hub/index.js";

const PREFIX = "/api/sidecar/sessions";
const ALLOW_LIST_PATH = "/api/sidecar/allow-list";
const SETTINGS_PATH = "/api/sidecar/settings";
const LENSES_PATH = "/api/sidecar/lenses";
const PROPOSALS_PATH = "/api/sidecar/proposals";

/**
 * The registry as the drawer reads it: every lens, what an unavailable one
 * waits on, and the item kind a lens needs attached.
 */
function sidecarLenses(ctx: ServerContext): Array<{ id: string; available: boolean; needs?: string; target?: LensTarget }> {
  return LENS_IDS.map((id) => {
    const plan = LENS_PACKETS[id];
    if (plan.kind === "unavailable") return { id, available: false, needs: plan.needs };
    // This listing is a worktree's: a hub-only lens cannot open here.
    if (plan.kind === "packet" && plan.scope === "hub") return { id, available: false, needs: HUB_SCOPE_NEEDS };
    // Read per request, like every feature gate: turning the feature on or off needs no restart.
    if (plan.kind === "packet" && plan.feature && !isFeatureEnabled(ctx.projectDir, plan.feature.key)) {
      return { id, available: false, needs: plan.feature.needs };
    }
    return plan.kind === "packet" && plan.target ? { id, available: true, target: plan.target } : { id, available: true };
  });
}

/** Why a start is refused when every run slot is taken; the refusal and the work card's preview say it alike. */
const CONCURRENT_LIMIT_REASON = (
  inUse: number,
  max: number,
  holders: ReadonlyArray<{ taskId: string | null; worktree: string }> = [],
): string =>
  `the concurrent run limit is reached (${inUse} of ${max} runs across the repository, guard.maxConcurrentProcesses)` +
  (holders.length > 0
    ? `; held by ${holders.map((h) => `${h.taskId ? `task ${h.taskId}` : "an untagged run"} in ${h.worktree}`).join(", ")}`
    : "");

/** Announces that a card was raised or settled; fetch `…/cards` for it. */
export interface SidecarCardMessage {
  type: "sidecar:card";
  sessionId: string;
  cardId: string;
  status: SidecarCardStatus;
  timestamp: string;
}

/** Announces that a session's transcript grew, or that its turn settled. */
export interface SidecarFramesMessage {
  type: "sidecar:frames";
  sessionId: string;
  /** Sequence number of the last frame; fetch `frames?after=` the cursor you hold. */
  cursor: number;
  /** False on the announcement that closes a turn. */
  running: boolean;
  /** How the turn ended; only on the closing announcement. */
  status?: SessionTurnStatus;
  /** Why the turn failed; only on a failed closing announcement. */
  error?: string;
  /** The failure is the vendor CLI's sign-in error, so the drawer can name the login command. */
  signedOut?: true;
  timestamp: string;
}

export interface SidecarSessionResponse {
  session: SidecarSessionRecord;
  running: boolean;
  /** What the session's tokens cost at the session model's rates. */
  estimatedCost: CostEstimate;
}

export interface SidecarTurnStartedResponse extends SidecarSessionResponse {
  /** Fetch `frames?after=` this to read the turn from its prompt on. */
  from: number;
}

export interface SidecarFramesResponse {
  frames: SidecarFrame[];
  /** The cursor to fetch after next: the last frame's seq, else `after`. */
  cursor: number;
  running: boolean;
}

/**
 * The repository's worktrees by workspace key, from the server's workspace
 * registry. Injected by start.ts (`sidecarWorkspacesOf`), so these routes
 * never import the registry. The Diagnose branch lens reads the worktree its
 * attached workspace key names.
 */
export interface SidecarWorkspaces {
  listWorkspaces(): ReadonlyArray<{ key: string; path: string }>;
}

/**
 * The branch status of the worktree `key` names, as the Diagnose branch lens
 * and a `github_read` of kind `pr` read it. The session's own workspace is
 * known without the registry. gh runs only when `githubReads` says it may.
 */
export async function readWorktreeBranchHealth(
  ctx: ServerContext,
  workspaces: SidecarWorkspaces | undefined,
  key: string,
  githubReads: boolean,
  exec?: BranchHealthExec,
): Promise<BranchHealthRead | string> {
  const path = key === ctx.workspace ? ctx.projectDir : workspaces?.listWorkspaces().find((w) => w.key === key)?.path;
  if (!path) return `"${key}" names no worktree of this repository`;
  try {
    const health = await collectProjectBranchHealth(path, { githubReads, localOnly: !githubReads, exec });
    return { worktree: { key, path }, own: resolve(path) === resolve(ctx.projectDir), githubReads, health };
  } catch (err) {
    return err instanceof NotAGitBranchError ? `${key} has no branch to report on: ${err.message}` : `branch health failed for ${key}: ${errorMessage(err)}`;
  }
}

export interface SidecarRouteOptions {
  /** The repository's worktrees, for the Diagnose branch lens; without it only the session's own workspace is known. */
  workspaces?: SidecarWorkspaces;
  /** The registry for a project directory. Defaults to one per directory, kept for the server's life. */
  registryFor?: (projectDir: string) => SidecarSessionRegistry;
  /** The broker for a project directory. Defaults to one per directory, kept for the server's life. */
  brokerFor?: (projectDir: string) => SidecarBroker;
  /** What an approved broker call does. Defaults to {@link sidecarActions}. */
  actionsFor?: (ctx: ServerContext) => SidecarActions;
  /** The hub-scope session's seams. */
  hub?: HubSidecarRouteOptions;
}

export interface HubSidecarRouteOptions {
  /** The per-user directory; defaults to `resolveNdxHome`'s answer. */
  homeDir?: string;
  /** This server's pid as the host lock records it. Defaults to `process.pid`. */
  pid?: number;
  /** Injected for tests: whether a lock holder's pid is alive. */
  isAlive?: (pid: number) => boolean;
  /** The registry over `dir`, built each time this server takes the host lock. Defaults to {@link createHubSidecarRegistry}. */
  registryFor?: (dir: string) => SidecarSessionRegistry;
  /** The broker over `dir`. Defaults to an announcing broker, built with the registry. */
  brokerFor?: (dir: string) => SidecarBroker;
  /** What an approved broker call does. Defaults to {@link hubSidecarActions}. */
  actions?: SidecarActions;
  /** The snapshot reads' fetch, for tests. */
  fetch?: typeof fetch;
}

/**
 * Where a session in `ctx`'s workspace reaches its broker: this server's own
 * loopback port, addressed to the workspace. No port (a test context) means no broker.
 * The session presents its own broker credential, never the dashboard token:
 * the config file that holds it is readable by the session's Read tool.
 */
export function sidecarBrokerEndpoint(ctx: ServerContext, sessionId: string): SidecarBrokerEndpoint | undefined {
  if (!ctx.port) return undefined;
  return {
    url: `http://127.0.0.1:${ctx.port}${PREFIX}/${sessionId}/mcp`,
    headers: {
      [SIDECAR_BROKER_KEY_HEADER]: sidecarBrokerCredential(sessionId),
      ...(ctx.workspace && { [WORKSPACE_HEADER]: ctx.workspace }),
    },
  };
}

/**
 * The two Describe reads, through the Prepare route's own seams: `ndx work
 * --resolve` and `--dry-run` with no run options, as the modal opens. A read
 * that fails answers `null`, so the packet marks that part unavailable and the
 * session still starts.
 */
export function prepareReads(
  ctx: ServerContext,
  reads: {
    resolve: typeof resolveTaskRun;
    preview: typeof previewTaskRun;
    diagnose: typeof diagnoseTaskRun;
    queuePlan: typeof readQueuePlan;
  } = {
    resolve: resolveTaskRun,
    preview: previewTaskRun,
    diagnose: diagnoseTaskRun,
    queuePlan: readQueuePlan,
  },
  workspaces?: SidecarWorkspaces,
): SpawnedReads {
  return {
    featureEnabled: (key) => isFeatureEnabled(ctx.projectDir, key),
    // gh runs for the packet only under the project's allowance; otherwise the agent asks with a github_read card.
    branchHealth: (key) => readWorktreeBranchHealth(ctx, workspaces, key, readSidecarSettings(ctx.projectDir).githubReads),
    async queuePlan(signal) {
      const read = await reads.queuePlan(ctx, signal).catch(() => null);
      return read?.ok ? read.plan : null;
    },
    async diagnose(runId, signal) {
      const read = await reads.diagnose(ctx, runId, signal).catch(() => null);
      return read?.ok ? readDiagnosis(read.diagnosis) ?? null : null;
    },
    async resolve(taskId, signal) {
      const read = await reads.resolve(ctx, taskId, {}, signal).catch(() => null);
      return read?.ok ? readResolution(read.resolution) : null;
    },
    async preview(taskId, signal) {
      const read = await reads.preview(ctx, taskId, {}, signal).catch(() => null);
      return read?.ok ? read.brief : null;
    },
  };
}

/**
 * Checkpoint wiring for `ctx`'s workspace: the project's ceiling for the
 * session's scope (read per turn), its ledger, and its lens's packet rebuilt
 * from disk. The two reads that spawn `ndx` go through the Prepare route's
 * seams ({@link prepareReads}).
 */
export function sidecarContextOptions(ctx: ServerContext, reads: SpawnedReads = prepareReads(ctx)): SidecarContextOptions {
  const dir = worktreeSidecarDir(ctx.projectDir);
  return {
    ceiling: (record) => resolveContextCeiling(ctx.projectDir, record.scope),
    ledger: (record) => readLedger(dir, record.id),
    packet: async (record, signal) => {
      const sources = createPacketSources(ctx, reads);
      const built = await buildLensPacket(record.lens ?? "general", record.target ?? {}, sources, new Date().toISOString(), signal);
      return built.status === "ready" ? built.packet.text : undefined;
    },
  };
}

/**
 * The effects of an approved broker call in `ctx`'s workspace: a command
 * runs as the workspace's Sidecar command job (job tray, Live) and the agent
 * waits up to `commandWaitMs` for its output, work starts through the hench
 * execute route under `guard.maxConcurrentProcesses`, and a work card's
 * preview is the Prepare route's `ndx work --resolve`. A change-set card is
 * read against the workspace's PRD before it is raised and written there,
 * under the PRD lock, on approval (`sidecar/change-set.ts`).
 */
export function sidecarActions(
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
  {
    commandWaitMs = SIDECAR_COMMAND_WAIT_MS,
    workspaces,
    exec = llmExec,
  }: { commandWaitMs?: number; workspaces?: SidecarWorkspaces; exec?: BranchHealthExec } = {},
): SidecarActions {
  return {
    githubReadsAllowed: () => readSidecarSettings(ctx.projectDir).githubReads,
    async githubRead(read) {
      if (read.kind === "check") return baseCheckResult(await readCheckOnBase(exec, ctx.projectDir, read.ref, read.base), read.ref, read.base);
      const health = await readWorktreeBranchHealth(ctx, workspaces, read.ref, true, exec);
      if (typeof health === "string") return { ok: false, text: `Nothing was read: ${health}.` };
      const { github, githubReason } = health.health;
      // Failed-check logs can quote a secret the job printed, and this text goes to the vendor.
      return github
        ? { ok: true, text: redactSecrets(githubFactsBody(github)) }
        : { ok: false, text: `No GitHub facts for ${read.ref}: ${githubReason ?? "gh did not answer"}` };
    },
    postGithub: (draft) => postGithubDraft(exec, ctx.projectDir, draft),
    async previewWork(taskId, options) {
      const read = await resolveTaskRun(ctx, taskId, options);
      const { inUse, max, holders } = await repositoryRunSlotUsage(ctx);
      // The limit is where approving is refused (see startWork), so the card says how near it is.
      const slots = `Active runs: ${inUse} of ${max}${inUse >= max ? ` (the limit: approving now starts nothing, ${CONCURRENT_LIMIT_REASON(inUse, max, holders)})` : ""}`;
      return `${read.ok ? renderWorkPreview(read.resolution, openTaskBlockers(ctx, taskId)) : `ndx work --resolve did not answer: ${read.failure}`}\n${slots}`;
    },
    async readRunPlan(signal) {
      if (!isFeatureEnabled(ctx.projectDir, "hench.readyNext")) return "the hench.readyNext feature is off";
      const read = await readQueuePlan(ctx, signal).catch((err: unknown) => ({ ok: false as const, failure: errorMessage(err) }));
      return read.ok ? read.plan : read.failure;
    },
    runCommand(argv, signal) {
      const started = startSidecarCommand(ctx, argv, broadcast);
      return started.started
        ? awaitSidecarCommand(started, commandWaitMs, signal)
        : { ok: false, text: `Nothing ran: ${started.reason}.` };
    },
    reviewChangeSet(input) {
      return reviewChangeSet(ctx.rexDir, input);
    },
    async writeChangeSet(changeSet) {
      try {
        const written = await writeChangeSet(ctx, changeSet, broadcast);
        return { ok: true, text: written.text, ids: written.ids };
      } catch (err) {
        return { ok: false, text: `Nothing was written: ${errorMessage(err)}.` };
      }
    },
    async startWork(taskId, options) {
      const { inUse, max, holders } = await repositoryRunSlotUsage(ctx);
      if (inUse >= max) return { ok: false, text: `Nothing started: ${CONCURRENT_LIMIT_REASON(inUse, max, holders)}.` };
      const answer = await startTaskExecution(ctx, { taskId, ...(options && { options }) }, broadcast);
      if (answer.status !== 202) return { ok: false, text: `Nothing started: ${String(answer.body.error ?? `the execute route answered ${answer.status}`)}.` };
      return { ok: true, text: `Started run ${String(answer.body.runId)} on task ${taskId} (${String(answer.body.taskTitle)}); follow it on Live.` };
    },
  };
}

/**
 * Appends each finished turn to the dashboard usage ledger as its own
 * `sidecar` command, so the spend reaches LLM Utilization in a bucket apart
 * from Ask. An interrupted turn that never reached the vendor spent nothing
 * and is not recorded.
 */
export function sidecarTurnSpendRecorder(ctx: ServerContext): NonNullable<SidecarRegistryOptions["onTurnSpend"]> {
  return ({ record, status, tokens }) => {
    if (status === "interrupted" && tokens.input === 0 && tokens.output === 0) return;
    recordDashboardUsage(ctx.projectDir, {
      timestamp: new Date().toISOString(),
      command: SIDECAR_COMMAND,
      vendor: record.vendor,
      model: record.model ?? "unknown",
      ...tokenFields(tokens),
      calls: 1,
      outcome: status === "completed" ? "success" : "error",
      ...(record.lens && { lens: record.lens }),
    });
  };
}

const registries = new Map<string, SidecarSessionRegistry>();
const brokers = new Map<string, SidecarBroker>();

function defaultRegistryFor(ctx: ServerContext, workspaces: SidecarWorkspaces | undefined): SidecarSessionRegistry {
  let registry = registries.get(ctx.projectDir);
  if (!registry) {
    registry = createWorktreeSidecarRegistry(ctx.projectDir, {
      broker: (id) => sidecarBrokerEndpoint(ctx, id),
      context: sidecarContextOptions(ctx, prepareReads(ctx, undefined, workspaces)),
      ttlMs: () => resolveSidecarIdleMs(ctx.projectDir),
      onTurnSpend: sidecarTurnSpendRecorder(ctx),
    });
    registries.set(ctx.projectDir, registry);
  }
  return registry;
}

/** Build a broker for `projectDir` that announces its cards through `broadcast`. */
export function createAnnouncingBroker(dir: string, broadcast: WebSocketBroadcaster): SidecarBroker {
  return new SidecarBroker({
    dir,
    onCard: (card: SidecarCard) => {
      const message: SidecarCardMessage = {
        type: "sidecar:card",
        sessionId: card.sessionId,
        cardId: card.id,
        status: card.status,
        timestamp: new Date().toISOString(),
      };
      broadcast(message);
    },
  });
}

/** The workspace's broker. Its broadcaster is the first request's, which is tagged for the same workspace. */
function defaultBrokerFor(projectDir: string, broadcast: WebSocketBroadcaster): SidecarBroker {
  let broker = brokers.get(projectDir);
  if (!broker) {
    broker = createAnnouncingBroker(worktreeSidecarDir(projectDir), broadcast);
    brokers.set(projectDir, broker);
  }
  return broker;
}

/** Answer an error; true, so a handler can `return refuse(…)`. */
function refuse(res: ServerResponse, status: number, message: string): true {
  errorResponse(res, status, message);
  return true;
}

/** The body as a JSON object (empty body: `{}`), else the reason it is not one. */
async function readJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | string> {
  let parsed: unknown;
  try {
    const body = await readBody(req, res);
    parsed = body.trim() ? JSON.parse(body) : {};
  } catch (err) {
    return `Invalid request body: ${errorMessage(err)}`;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : "Request body must be a JSON object";
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined | Error {
  const value = body[key];
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : new Error(`"${key}" must be a non-empty string`);
}

/** `target` as `{ ref: string }`; absent is undefined. */
function readTarget(body: Record<string, unknown>): PacketTarget | undefined | Error {
  const value = body.target;
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Error(`"target" must be an object`);
  const ref = optionalString(value as Record<string, unknown>, "ref");
  return ref instanceof Error ? ref : ref === undefined ? {} : { ref };
}

function sessionResponse(registry: SidecarSessionRegistry, session: SidecarSessionRecord): SidecarSessionResponse {
  const { input, output, cacheCreationInput = 0, cacheReadInput = 0 } = session.tokens;
  const totals = { inputTokens: input, outputTokens: output, cacheCreationTokens: cacheCreationInput, cacheReadTokens: cacheReadInput };
  // A session with no pinned model has none to price by: its tokens reach the
  // estimate as the unattributed residual, at the labelled fallback rate.
  const estimatedCost = estimateCostFromTotals(totals, session.model ? { [session.model]: totals } : undefined);
  return { session, running: registry.isRunning(session.id), estimatedCost };
}

/**
 * Start the turn in the background and announce every frame it appends.
 * The caller has checked that the session exists, is open and is idle.
 */
function startTurn(
  registry: SidecarSessionRegistry,
  broker: SidecarBroker,
  id: string,
  prompt: string,
  broadcast: WebSocketBroadcaster,
): void {
  const announce = (fields: Omit<SidecarFramesMessage, "type" | "sessionId" | "timestamp">): void => {
    const message: SidecarFramesMessage = {
      type: "sidecar:frames",
      sessionId: id,
      ...fields,
      timestamp: new Date().toISOString(),
    };
    broadcast(message);
  };
  // Close the turn on the socket first: a failed save of the outcome (a full
  // or read-only disk) must not leave the drawer running or reject unhandled.
  const close = (status: SessionTurnStatus, error?: string): void => {
    const outcome: SidecarTurnOutcome = {
      status,
      ...(error && { error }),
      ...(status === "failed" && error && isAuthError(error) && { signedOut: true as const }),
    };
    announce({ cursor: registry.get(id)?.cursor ?? 0, running: false, ...outcome, status });
    try {
      registry.recordTurnEnd(id, outcome);
    } catch (err) {
      console.error(`[sidecar] could not save how the turn in session ${id} ended: ${errorMessage(err)}`);
    }
  };
  // The user frame is appended synchronously inside sendTurn, before it
  // first awaits, so it is on disk by the time the POST answers.
  registry.sendTurn(id, prompt, (frame) => announce({ cursor: frame.seq, running: true })).finally(() => {
    // Nothing waits on a card once its turn is over.
    broker.withdraw(id, "The turn ended");
  }).then(
    (result) => close(result.status, result.error),
    (err: unknown) => {
      const error = errorMessage(err);
      console.error(`[sidecar] turn in session ${id} failed: ${error}`);
      close("failed", error);
    },
  );
}

/** Parse `after` from the query: a non-negative integer, default 0. */
function parseAfter(search: string): number | Error {
  const raw = new URLSearchParams(search).get("after");
  if (raw === null || raw === "") return 0;
  const after = Number(raw);
  return Number.isInteger(after) && after >= 0 ? after : new Error(`"after" must be a non-negative integer, got "${raw}"`);
}

// ── Hub scope ────────────────────────────────────────────────────────────

const HUB_SESSIONS = `${HUB_SIDECAR_API_PREFIX}/sessions`;
const HUB_LENS = "hub";
const HUB_NO_EFFECT = "a hub session drafts and never acts, so this call does nothing from the hub";

/**
 * What an approved broker call does in the hub session: nothing. Every
 * effect refuses, naming why, and no network read runs without a card.
 */
export function hubSidecarActions(): SidecarActions {
  const refused = { ok: false, text: `Nothing was done: ${HUB_NO_EFFECT}.` };
  return {
    previewWork: async () => HUB_NO_EFFECT,
    runCommand: () => refused,
    startWork: async () => refused,
    reviewChangeSet: async () => HUB_NO_EFFECT,
    writeChangeSet: async () => refused,
    readRunPlan: async () => HUB_NO_EFFECT,
    githubReadsAllowed: () => false,
    githubRead: async () => refused,
    postGithub: async () => refused,
  };
}

/** Where the hub session reaches its broker: this host's own loopback port, with the session's broker credential only. */
export function hubSidecarBrokerEndpoint(ctx: ServerContext, sessionId: string): SidecarBrokerEndpoint | undefined {
  if (!ctx.port) return undefined;
  return {
    url: `http://127.0.0.1:${ctx.port}${HUB_SESSIONS}/${sessionId}/mcp`,
    headers: { [SIDECAR_BROKER_KEY_HEADER]: sidecarBrokerCredential(sessionId) },
  };
}

/**
 * Checkpoint wiring for the hub session: the host project's hub ceiling
 * (`web.sidecarContextCeiling.hub`, default 40k, read per turn), the
 * session's ledger, and the hub lens's packet rebuilt from a fresh snapshot
 * on every turn.
 */
export function hubSidecarContextOptions(ctx: ServerContext, dir: string, opts: HubSidecarRouteOptions = {}): SidecarContextOptions {
  // The fingerprints of the snapshot each session's latest packet was built
  // from, written only once a turn carrying it completes.
  const pending = new Map<string, () => void>();
  return {
    ceiling: () => resolveContextCeiling(ctx.projectDir, "hub"),
    ledger: (record) => readLedger(dir, record.id),
    packetEveryTurn: true,
    packetDelivered: (record) => {
      pending.get(record.id)?.();
      pending.delete(record.id);
    },
    packet: async (record, signal) => {
      pending.delete(record.id);
      const read = hubSnapshotReader(dir, record.id, { homeDir: opts.homeDir, ...(opts.fetch && { fetch: opts.fetch }) });
      const sources: PacketSources = {
        ...createPacketSources(ctx, prepareReads(ctx)),
        hubSnapshot: async (s) => {
          const got = await read(s);
          if (typeof got !== "string") pending.set(record.id, got.commit);
          return got;
        },
      };
      const built = await buildLensPacket(record.lens ?? HUB_LENS, {}, sources, new Date().toISOString(), signal);
      return built.status === "ready" ? built.packet.text : undefined;
    },
  };
}

interface HubHostState {
  registry: SidecarSessionRegistry;
  broker: SidecarBroker;
}

/** This server's view of the hub session while it holds the host lock, by directory and pid. */
const hubHosts = new Map<string, HubHostState>();

/**
 * The registry and broker this host serves the hub session with. Rebuilt
 * from disk whenever the lock was just taken: another host may have run
 * turns since this server last held it.
 */
function hubHostState(
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
  opts: HubSidecarRouteOptions,
  dir: string,
  pid: number,
  acquired: boolean,
): HubHostState {
  const key = `${dir}\0${pid}`;
  let state = hubHosts.get(key);
  if (!state || acquired) {
    state = {
      registry: opts.registryFor
        ? opts.registryFor(dir)
        : createHubSidecarRegistry({
            dir,
            hostProjectDir: ctx.projectDir,
            broker: (id) => hubSidecarBrokerEndpoint(ctx, id),
            context: hubSidecarContextOptions(ctx, dir, opts),
            ttlMs: () => resolveSidecarIdleMs(ctx.projectDir),
            onTurnSpend: sidecarTurnSpendRecorder(ctx),
          }),
      broker: opts.brokerFor ? opts.brokerFor(dir) : createAnnouncingBroker(dir, broadcast),
    };
    hubHosts.set(key, state);
  }
  return state;
}

/** The machine's open hub session, if there is one. */
function openHubSession(registry: SidecarSessionRegistry): SidecarSessionRecord | undefined {
  return registry.list({ scope: "hub" }).find((session) => !session.endedAt);
}

/**
 * Create the hub session, or answer the open one: there is one per machine.
 * Claude only (see `hubVendorRefusal`). `hostedElsewhere` is set when this
 * server does not hold the host lock: it may name the open session, never
 * create one.
 */
function createHubSession(
  registry: SidecarSessionRegistry,
  dir: string,
  body: Record<string, unknown>,
  hostedElsewhere?: string,
): CreateAnswer {
  const vendor = optionalString(body, "vendor");
  if (!vendor || vendor instanceof Error) return { status: 400, error: `"vendor" must be "claude"` };
  const refusal = hubVendorRefusal(vendor);
  if (refusal) return { status: 400, error: refusal };
  const fields = readNameAndModel(body);
  if (fields instanceof Error) return { status: 400, error: fields.message };
  const lens = optionalString(body, "lens");
  if (lens instanceof Error) return { status: 400, error: lens.message };
  if (lens !== undefined && lens !== HUB_LENS) return { status: 400, error: `A hub session runs the ${HUB_LENS} lens, not "${lens}"` };
  if (body.target !== undefined) return { status: 400, error: "A hub session takes no target" };
  const open = openHubSession(registry);
  if (open) return { status: 200, session: open };
  if (hostedElsewhere) return { status: 409, error: hostedElsewhere };
  return {
    status: 201,
    session: registry.create({ scope: "hub", worktree: dir, vendor, name: fields.name ?? "Hub session", ...(fields.model && { model: fields.model }), lens: HUB_LENS }),
  };
}

/**
 * The hub-scope session routes, `/api/sidecar/hub/sessions…`, which the hub
 * serves at `/hub/session/sessions…`. The same session routes as a
 * worktree's, over `<ndx home>/hub/sidecar/`, served only by the server
 * holding the host lock. Another server answers a create with the open
 * session (`hostedBy` naming its host) and everything else with 409.
 */
async function handleHubSidecarRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
  opts: HubSidecarRouteOptions = {},
  pathname: string,
  search: string,
): Promise<boolean> {
  if (!ctx.port) return refuse(res, 503, "This server has no port, so it cannot host the hub session");
  const home = resolveHubHome(opts.homeDir);
  const dir = hubSidecarDir(home);
  const pid = opts.pid ?? process.pid;
  const claim = claimHubSessionHost(home, { pid, port: ctx.port, ...(opts.isAlive && { isAlive: opts.isAlive }) });

  if (!claim.held) {
    const { holder } = claim;
    const hosted = `The hub session is hosted by the project server with pid ${holder.pid} on port ${holder.port}`;
    if (pathname !== HUB_SESSIONS || (req.method || "GET") !== "POST") return refuse(res, 409, hosted);
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    // Read from disk, never served: this server's registry would go stale under the host's turns.
    const onDisk = new SidecarSessionRegistry({ dir, connect: () => { throw new Error(hosted); } });
    const answer = createHubSession(onDisk, dir, body, hosted);
    if ("error" in answer) return refuse(res, answer.status, answer.error);
    jsonResponse(res, 200, { session: answer.session, hostedBy: holder });
    return true;
  }

  const { registry, broker } = hubHostState(ctx, broadcast, opts, dir, pid, claim.acquired);
  return handleSessionRoutes(req, res, pathname, search, {
    prefix: HUB_SESSIONS,
    worktree: dir,
    registry,
    broker,
    broadcast,
    actions: () => opts.actions ?? hubSidecarActions(),
    create: (body) => createHubSession(registry, dir, body),
    lens: HUB_LENS,
  });
}

export async function handleSidecarRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
  opts: SidecarRouteOptions = {},
): Promise<boolean> {
  const [pathname, search = ""] = (req.url || "/").split("?");
  if (pathname === HUB_SIDECAR_API_PREFIX || pathname.startsWith(`${HUB_SIDECAR_API_PREFIX}/`)) {
    return handleHubSidecarRoute(req, res, ctx, broadcast, opts.hub, pathname, search);
  }
  if (
    pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)
    && pathname !== ALLOW_LIST_PATH && pathname !== SETTINGS_PATH && pathname !== LENSES_PATH && pathname !== PROPOSALS_PATH
  ) {
    return false;
  }
  const method = req.method || "GET";
  const registry = opts.registryFor ? opts.registryFor(ctx.projectDir) : defaultRegistryFor(ctx, opts.workspaces);
  const broker = opts.brokerFor ? opts.brokerFor(ctx.projectDir) : defaultBrokerFor(ctx.projectDir, broadcast);

  if (pathname === LENSES_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${LENSES_PATH}`);
    jsonResponse(res, 200, { lenses: sidecarLenses(ctx) });
    return true;
  }

  if (pathname === PROPOSALS_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${PROPOSALS_PATH}`);
    jsonResponse(res, 200, { cards: broker.proposals() });
    return true;
  }

  if (pathname === SETTINGS_PATH) {
    if (method === "GET") {
      jsonResponse(res, 200, readSidecarSettings(ctx.projectDir));
      return true;
    }
    if (method === "PUT") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const saved = saveSidecarSettings(ctx.projectDir, body);
      if ("error" in saved) return refuse(res, 400, saved.error);
      for (const file of saved.files) await commitSettingsChange(ctx.projectDir, file, "sidecar");
      jsonResponse(res, 200, readSidecarSettings(ctx.projectDir));
      return true;
    }
    return refuse(res, 405, `${method} is not supported on ${SETTINGS_PATH}`);
  }

  if (pathname === ALLOW_LIST_PATH) {
    if (method === "GET") {
      jsonResponse(res, 200, { rules: broker.allowList() });
      return true;
    }
    if (method === "DELETE") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const { tool, key } = body;
      if (typeof tool !== "string" || !isBrokerTool(tool) || typeof key !== "string") {
        return refuse(res, 400, `"tool" must be a broker tool and "key" a string`);
      }
      jsonResponse(res, 200, { removed: broker.revoke({ tool, key }) });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const { tool, argv } = body;
      if (typeof tool !== "string" || !isBrokerTool(tool)) return refuse(res, 400, `"tool" must be a broker tool`);
      try {
        const dryRun = new URLSearchParams(search).get("dryRun") === "1";
        jsonResponse(res, 200, { rule: dryRun ? broker.checkAllow(tool, { argv }) : broker.allow(tool, { argv }) });
      } catch (err) {
        if (err instanceof BrokerDecisionError) return refuse(res, err.status, err.message);
        throw err;
      }
      return true;
    }
    return refuse(res, 405, `${method} is not supported on ${ALLOW_LIST_PATH}`);
  }

  return handleSessionRoutes(req, res, pathname, search, {
    prefix: PREFIX,
    worktree: ctx.projectDir,
    registry,
    broker,
    broadcast,
    actions: () => (opts.actionsFor ? opts.actionsFor(ctx) : sidecarActions(ctx, broadcast, { workspaces: opts.workspaces })),
    create: (body) => createWorktreeSession(registry, ctx.projectDir, body),
  });
}

/** What a create answers: the session and its status, or a refusal. */
type CreateAnswer = { status: 200 | 201; session: SidecarSessionRecord } | { status: 400 | 409; error: string };

/** One scope's session routes: where they are, whose sessions they serve, and how one is created. */
interface SessionRouteScope {
  /** The sessions collection's path. */
  prefix: string;
  /** The checkout whose sessions these are; a session of any other is 404. */
  worktree: string;
  registry: SidecarSessionRegistry;
  broker: SidecarBroker;
  broadcast: WebSocketBroadcaster;
  /** What an approved broker call does. */
  actions: () => SidecarActions;
  create: (body: Record<string, unknown>) => CreateAnswer;
  /** The one lens this scope's sessions run; a PATCH to another, or to a target, is refused. */
  lens?: string;
}

/** The `name` and `model` fields of a create body, each a non-empty string when present. */
function readNameAndModel(body: Record<string, unknown>): { name?: string; model?: string } | Error {
  const fields: { name?: string; model?: string } = {};
  for (const key of ["model", "name"] as const) {
    const value = optionalString(body, key);
    if (value instanceof Error) return value;
    if (value !== undefined) fields[key] = value;
  }
  return fields;
}

function createWorktreeSession(registry: SidecarSessionRegistry, worktree: string, body: Record<string, unknown>): CreateAnswer {
  const vendor = optionalString(body, "vendor");
  if (!vendor || vendor instanceof Error || !vendorSessionDriver(vendor)) {
    return { status: 400, error: `"vendor" must be a vendor with a resumable CLI session (claude, codex)` };
  }
  const fields = readNameAndModel(body);
  if (fields instanceof Error) return { status: 400, error: fields.message };
  const lens = optionalString(body, "lens");
  if (lens instanceof Error) return { status: 400, error: lens.message };
  const target = readTarget(body);
  if (target instanceof Error) return { status: 400, error: target.message };
  const session = registry.create({
    scope: "worktree", worktree, vendor, ...fields, ...(lens && { lens }), ...(target && { target }),
  });
  return { status: 201, session };
}

async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  search: string,
  scope: SessionRouteScope,
): Promise<boolean> {
  const method = req.method || "GET";
  const { prefix, registry, broker, broadcast } = scope;
  if (pathname === prefix) {
    if (method === "GET") {
      const sessions = registry.list({ worktree: scope.worktree })
        .map((session) => sessionResponse(registry, session));
      jsonResponse(res, 200, { sessions });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const created = scope.create(body);
      if ("error" in created) return refuse(res, created.status, created.error);
      jsonResponse(res, created.status, sessionResponse(registry, created.session));
      return true;
    }
    return refuse(res, 405, `${method} is not supported on ${prefix}`);
  }
  if (!pathname.startsWith(`${prefix}/`)) return false;

  const match = /^\/([\w-]+)(?:\/(turns|frames|interrupt|end|cards|mcp)(?:\/([\w-]+))?)?$/
    .exec(pathname.slice(prefix.length));
  if (!match) return false;
  const [, id, action, cardId] = match;
  if (cardId !== undefined && action !== "cards") return false;
  const session = registry.get(id);
  // One answer for a session this worktree does not hold, whether it does not
  // exist or belongs to another worktree's checkout.
  if (!session || session.worktree !== scope.worktree) return refuse(res, 404, `No Sidecar session ${id}`);

  if (action === undefined && method === "PATCH") {
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    const fields: { name?: string; lens?: string } = {};
    for (const key of ["name", "lens"] as const) {
      const value = optionalString(body, key);
      if (value instanceof Error) return refuse(res, 400, value.message);
      if (value !== undefined) fields[key] = value;
    }
    const target = readTarget(body);
    if (target instanceof Error) return refuse(res, 400, target.message);
    if (scope.lens && ((fields.lens !== undefined && fields.lens !== scope.lens) || target)) {
      return refuse(res, 400, `A ${scope.lens} session keeps the ${scope.lens} lens and takes no target`);
    }
    if ((fields.lens !== undefined || target) && session.endedAt) {
      return refuse(res, 409, `Sidecar session ${id} has ended`);
    }
    const updated = registry.update(id, { ...fields, ...(target && { target }) }) ?? session;
    jsonResponse(res, 200, sessionResponse(registry, updated));
    return true;
  }

  const reads = action === "frames" || action === undefined || (action === "cards" && cardId === undefined);
  const allowed = reads ? "GET" : "POST";
  if (method !== allowed) return refuse(res, 405, `${method} is not supported on ${pathname}`);

  switch (action) {
    case undefined:
      jsonResponse(res, 200, sessionResponse(registry, session));
      return true;

    case "frames": {
      const after = parseAfter(search);
      if (after instanceof Error) return refuse(res, 400, after.message);
      const frames = registry.readFrames(id, after);
      const response: SidecarFramesResponse = {
        frames,
        cursor: frames.at(-1)?.seq ?? after,
        running: registry.isRunning(id),
      };
      jsonResponse(res, 200, response);
      return true;
    }

    case "turns": {
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      const prompt = body.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return refuse(res, 400, `"prompt" must be a non-empty string`);
      if (session.endedAt) return refuse(res, 409, `Sidecar session ${id} has ended`);
      if (registry.isRunning(id)) return refuse(res, 409, `A turn is already running in Sidecar session ${id}`);
      startTurn(registry, broker, id, prompt, broadcast);
      const started = registry.get(id) ?? session;
      // The turn's frames start with its prompt, the last frame appended so far.
      const response: SidecarTurnStartedResponse = { ...sessionResponse(registry, started), from: started.cursor - 1 };
      jsonResponse(res, 202, response);
      return true;
    }

    case "interrupt":
      broker.withdraw(id, "The operator stopped the turn");
      jsonResponse(res, 200, { interrupted: await registry.interrupt(id) });
      return true;

    case "end":
      broker.withdraw(id, SIDECAR_SESSION_ENDED_REASON);
      await registry.end(id);
      jsonResponse(res, 200, sessionResponse(registry, registry.get(id) ?? session));
      return true;

    case "cards": {
      if (cardId === undefined) {
        jsonResponse(res, 200, { cards: broker.cards(id) });
        return true;
      }
      const body = await readJsonObject(req, res);
      if (typeof body === "string") return refuse(res, 400, body);
      if (body.decision !== "approve" && body.decision !== "deny") {
        return refuse(res, 400, `"decision" must be "approve" or "deny"`);
      }
      const reason = optionalString(body, "reason");
      if (reason instanceof Error) return refuse(res, 400, reason.message);
      if (body.remember !== undefined && typeof body.remember !== "boolean") {
        return refuse(res, 400, `"remember" must be a boolean`);
      }
      if (body.lane !== undefined && typeof body.lane !== "number") return refuse(res, 400, `"lane" must be a number`);
      try {
        const card = broker.decide(id, cardId, {
          approve: body.decision === "approve",
          ...(reason && { reason }),
          ...(body.remember && { remember: true }),
          ...(body.edits !== undefined && { edits: body.edits }),
          ...(body.lane !== undefined && { lane: body.lane }),
        });
        jsonResponse(res, 200, { card });
      } catch (err) {
        if (!(err instanceof BrokerDecisionError)) throw err;
        return refuse(res, err.status, err.message);
      }
      return true;
    }

    case "mcp":
      // Only the session's own turn calls its broker; a card raised with no
      // turn running would wait on an agent that is not there.
      if (session.endedAt || !registry.isRunning(id)) {
        return refuse(res, 409, `Sidecar session ${id} has no running turn`);
      }
      await handleBrokerMcpRequest(req, res, broker, id, scope.actions());
      return true;
  }
  return false;
}
