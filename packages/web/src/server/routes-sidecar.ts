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
 * | GET  | `/api/sidecar/ledger/latest` | each open session's latest `unfinished` and `decision` notes, which the hub snapshot shows per worktree |
 * | POST | `/api/sidecar/handoff` | the hub's drill-down (`{ question, vendor }`): resume the latest open session or create one, leave a `handoff` entry naming the question, carry the ledger on its next turn |
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
 * the hub snapshot rebuilt every turn. It drafts and never acts: its broker
 * offers only `run_command` (a fixed read-only set per project), a
 * `draft_github_post` naming its project, `save_draft` and `ledger_append`
 * (`BROKER_SCOPE_TOOLS`), and carries out each only on an approved card
 * ({@link hubSidecarActions}). Beside them, any project server answers
 * `GET /api/sidecar/hub/drawer` (the drawer-only viewer page the hub home
 * docks) and `GET /api/sidecar/hub/lens` (whether it can run the hub lens,
 * and the hub ceiling); the host answers `GET /api/sidecar/hub/snapshot`, how
 * many snapshot items the open session's next turn marks Δ and the worktrees
 * it read, and `POST /api/sidecar/hub/handoff { project, worktree }`, "Open in
 * worktree sidecar": the open session's latest question handed, through the
 * hub, to that worktree's `/api/sidecar/handoff`. The hub session's ledger is
 * `<ndx home>/hub/ledger.jsonl`, written only by its `ledger_append`.
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

import { realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { exec as llmExec, isAuthError, redactSecrets, vendorSessionDriver } from "@n-dx/llm-client";
import type { SessionTurnStatus } from "@n-dx/llm-client";
import { SIDECAR_COMMAND, recordDashboardUsage, tokenFields } from "./dashboard-usage.js";
import { estimateCostFromTotals, prdLayout, type CostEstimate } from "./rex-gateway.js";
import type { ServerContext } from "./types.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { errorMessage, errorResponse, jsonResponse, readBody } from "./response-utils.js";
import { SIDECAR_BROKER_KEY_HEADER, sidecarBrokerCredential } from "./sidecar/broker-credential.js";
import { handleBrokerMcpRequest, type BrokerConnections } from "./sidecar/broker-mcp.js";
import { ConnectionService } from "./connections/connection-service.js";
import type { BrokerScope } from "./sidecar/broker-policy.js";
import { createHubActions } from "./sidecar/hub-actions.js";
import { isBrokerTool } from "./sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard, type SidecarCardStatus, type SidecarLedgerTarget } from "./sidecar/broker.js";
import { awaitSidecarCommand, renderWorkPreview, SIDECAR_COMMAND_WAIT_MS, type SidecarActions } from "./sidecar/carry-out.js";
import { reviewChangeSet, writeChangeSet } from "./sidecar/change-set.js";
import { readPlacementCall, readPlacementEdit, writePlacementCard, type PlacementEditRefusal } from "./sidecar/placement-card.js";
import { resolveNdxBin, startSidecarCommand } from "./routes-commands.js";
import { judgeRunInTarget, openTaskBlockers, readQueuePlan, repositoryRunSlotUsage, resolveRunTargets, startTaskExecution } from "./routes-hench.js";
import { isFeatureEnabled } from "./routes-features.js";
import { diagnoseTaskRun, previewTaskRun, resolveTaskRun } from "./routes-hench-prep.js";
import { readDiagnosis } from "./run-diagnosis.js";
import { HUB_CHECKPOINT_PROMPT, resolveContextCeiling } from "./sidecar/context-refresh.js";
import { readSidecarSettings, resolveSidecarIdleMs, saveSidecarSettings } from "./sidecar/settings.js";
import { commitSettingsChange } from "./settings-commit.js";
import {
  HUB_LEDGER_TYPES,
  LEDGER_ENTRY_MAX_CHARS,
  latestLedgerEntries,
  readLedger,
  readLedgerAt,
  SIDECAR_LEDGER_LATEST_PATH,
  type SidecarLedgerLatestResponse,
} from "./sidecar/ledger.js";
import { handOffToWorktree, SIDECAR_HANDOFF_PATH, type SidecarHandoffResponse } from "./sidecar/hub-handoff.js";
import { resolveHubAccess } from "./sidecar/hub-snapshot-fetch.js";
import type { HubSnapshotWorktreeRef } from "./sidecar/hub-snapshot.js";
import { buildLensPacket, HUB_SCOPE_NEEDS, LENS_IDS, LENS_PACKETS, type LensTarget } from "./sidecar/lens-packets.js";
import type { PacketTarget } from "./sidecar/packet-builders.js";
import { createPacketSources, readResolution, type BranchHealthRead, type PacketSources, type SpawnedReads } from "./sidecar/packet-sources.js";
import { githubFactsBody } from "./sidecar/branch-packet.js";
import { BRANCH_HEALTH_FEATURE_KEY, BRANCH_HEALTH_OFF_READ, baseCheckResult, postGithubDraft, readCheckOnBase, readDefaultBranchName } from "./sidecar/github.js";
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
  type WorktreeSidecarRegistryOptions,
} from "./sidecar/session-registry.js";
import { hubVendorRefusal, type SidecarBrokerEndpoint } from "./sidecar/spawn-policy.js";
import { hasHubSnapshotBaseline, hubSnapshotReader } from "./sidecar/hub-packet.js";
import { WORKSPACE_HEADER } from "./workspaces.js";
import {
  HUB_SESSION_CLOSE_MESSAGE,
  HUB_SESSION_PATH,
  HUB_SESSION_ROUTES,
  HUB_SIDECAR_API_PREFIX,
  SIDECAR_SESSION_ENDED_REASON,
  injectSessionScript,
  applySameOriginFramePolicy,
} from "../shared/index.js";
import {
  claimHubSessionHost,
  HUB_SESSION_FEATURE,
  hubLedgerPath,
  hubSidecarDir,
  recordHubUsage,
  releaseHubSessionHost,
  resolveHubHome,
} from "../hub/index.js";

const PREFIX = "/api/sidecar/sessions";
const ALLOW_LIST_PATH = "/api/sidecar/allow-list";
const SETTINGS_PATH = "/api/sidecar/settings";
const LENSES_PATH = "/api/sidecar/lenses";
const PROPOSALS_PATH = "/api/sidecar/proposals";

/**
 * The registry as the drawer reads it: every lens, what an unavailable one
 * waits on, and the item kind a lens needs attached.
 */
async function sidecarLenses(ctx: ServerContext): Promise<Array<{ id: string; available: boolean; needs?: string; target?: LensTarget }>> {
  // Read per request, like the feature gates: a migration needs no restart.
  const layout = await prdLayout(ctx.rexDir).catch(() => null);
  return LENS_IDS.map((id) => {
    const plan = LENS_PACKETS[id];
    if (plan.kind === "unavailable") return { id, available: false, needs: plan.needs };
    // This listing is a worktree's: a hub-only lens cannot open here.
    if (plan.kind === "packet" && plan.scope === "hub") return { id, available: false, needs: HUB_SCOPE_NEEDS };
    // Read per request, like every feature gate: turning the feature on or off needs no restart.
    if (plan.kind === "packet" && plan.feature && !isFeatureEnabled(ctx.projectDir, plan.feature.key)) {
      return { id, available: false, needs: plan.feature.needs };
    }
    if (plan.kind === "packet" && plan.layout && layout !== plan.layout.layout) return { id, available: false, needs: plan.layout.needs };
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

/** Why a start is refused while a run is live in this checkout: two runs in one checkout collide. */
const RUN_HERE_REASON = (here: ReadonlyArray<{ taskId: string | null }>): string =>
  `${here.map((h) => (h.taskId ? `task ${h.taskId}` : "an untagged run")).join(", ")} is already running in this checkout, and two runs in one checkout collide; run the task in a worktree of its own or wait for that run to end`;

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
  /**
   * The servers the operator connected, whose tools a worktree session's
   * broker re-exposes. Defaults to one {@link ConnectionService} per
   * directory over its `.n-dx.local.json`, kept for the server's life.
   */
  connectionsFor?: (projectDir: string) => BrokerConnections;
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
  /**
   * The registry over `dir`, built each time this server takes the host lock.
   * Defaults to {@link createHubSidecarRegistry}. `defaults` are the options
   * production builds it with (context, idle TTL, spend recorder), so a test
   * that swaps the vendor connection still runs the production ones.
   */
  registryFor?: (dir: string, defaults: WorktreeSidecarRegistryOptions) => SidecarSessionRegistry;
  /** The broker over `dir`. Defaults to an announcing broker, built with the registry. */
  brokerFor?: (dir: string) => SidecarBroker;
  /** What an approved broker call does. Defaults to {@link hubSidecarActions}. */
  actions?: SidecarActions;
  /** The snapshot reads' fetch, for tests. */
  fetch?: typeof fetch;
  /** Runs the hub's commands and gh posts; defaults to the llm-client `exec`. */
  exec?: BranchHealthExec;
  /** The built drawer-only viewer page (`dist/viewer/hub-session.html`); null when it was not built. */
  drawerHtml?: () => string | null;
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
    runTargets: typeof resolveRunTargets;
  } = {
    resolve: resolveTaskRun,
    preview: previewTaskRun,
    diagnose: diagnoseTaskRun,
    queuePlan: readQueuePlan,
    runTargets: resolveRunTargets,
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
    async diagnose(runId, dir, signal) {
      const read = await reads.diagnose(ctx, runId, dir, signal).catch(() => null);
      return read?.ok ? readDiagnosis(read.diagnosis) ?? null : null;
    },
    // Runs (`?scope=repo`) and Live read these same worktrees and judge with the same mirror.
    runTargets: () => reads.runTargets(ctx),
    judgeRun: (target, run) => judgeRunInTarget(target, run, Date.now()),
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
 * under the PRD lock, on approval (`sidecar/change-set.ts`). A placement card
 * is dry-run through rex before it is raised and written through the Inbox
 * routes' own write on approval (`sidecar/placement-card.ts`).
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
    branchHealthEnabled: () => isFeatureEnabled(ctx.projectDir, BRANCH_HEALTH_FEATURE_KEY),
    async githubRead(read) {
      if (read.kind === "check") {
        const [run, defaultBranch] = await Promise.all([
          readCheckOnBase(exec, ctx.projectDir, read.ref, read.base),
          readDefaultBranchName(exec, ctx.projectDir),
        ]);
        return baseCheckResult(run, read.ref, read.base, defaultBranch);
      }
      // The same gate as GET /api/branch-health, also for a card approved before the feature was turned off.
      if (!isFeatureEnabled(ctx.projectDir, BRANCH_HEALTH_FEATURE_KEY)) return { ok: false, text: BRANCH_HEALTH_OFF_READ };
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
      const { inUse, max, holders, here } = await repositoryRunSlotUsage(ctx);
      // Both refusals are in startWork, so the card says before Approve how near the limit is and whether this checkout is taken.
      const slots = `Active runs: ${inUse} of ${max}${inUse >= max ? ` (the limit: approving now starts nothing, ${CONCURRENT_LIMIT_REASON(inUse, max, holders)})` : ""}` +
        (here.length > 0 ? `\nApproving now starts nothing: ${RUN_HERE_REASON(here)}` : "");
      return `${read.ok ? renderWorkPreview(read.resolution, openTaskBlockers(ctx, taskId)) : `ndx work --resolve did not answer: ${read.failure}`}\n${slots}`;
    },
    async readRunPlan(signal) {
      if (!isFeatureEnabled(ctx.projectDir, "hench.readyNext")) return "the hench.readyNext feature is off";
      const read = await readQueuePlan(ctx, signal).catch((err: unknown) => ({ ok: false as const, failure: errorMessage(err) }));
      return read.ok ? read.plan : read.failure;
    },
    async runCommand(argv, signal) {
      const started = await startSidecarCommand(ctx, argv, broadcast);
      return started.started
        ? awaitSidecarCommand(started, commandWaitMs, signal)
        : { ok: false, text: `Nothing ran: ${started.reason}.` };
    },
    reviewChangeSet(input) {
      return reviewChangeSet(ctx.rexDir, input);
    },
    async writeChangeSet(changeSet, sessionId) {
      try {
        const written = await writeChangeSet(ctx, changeSet, sessionId, broadcast);
        return { ok: true, text: written.text, ids: written.ids };
      } catch (err) {
        return { ok: false, text: `Nothing was written: ${errorMessage(err)}.` };
      }
    },
    checkPlacement(input) {
      return readPlacementCall(ctx.rexDir, input);
    },
    writePlacement(placement, sessionId) {
      return writePlacementCard(ctx, placement, sessionId, broadcast);
    },
    async startWork(taskId, options) {
      const { inUse, max, holders, here } = await repositoryRunSlotUsage(ctx);
      if (here.length > 0) return { ok: false, text: `Nothing started: ${RUN_HERE_REASON(here)}.` };
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

/**
 * Appends each finished hub turn to `<ndx home>/hub/usage.jsonl`, never to the
 * host project's ledger: the hub session is the machine's, and whichever
 * project happens to host it did not spend this.
 */
export function hubTurnSpendRecorder(ctx: ServerContext, homeDir?: string): NonNullable<SidecarRegistryOptions["onTurnSpend"]> {
  return ({ record, status, tokens }) => {
    if (status === "interrupted" && tokens.input === 0 && tokens.output === 0) return;
    recordHubUsage(resolveHubHome(homeDir), {
      timestamp: new Date().toISOString(),
      command: SIDECAR_COMMAND,
      vendor: record.vendor,
      model: record.model ?? "unknown",
      ...tokenFields(tokens),
      calls: 1,
      outcome: status === "completed" ? "success" : "error",
      ...(record.lens && { lens: record.lens }),
      host: ctx.projectDir,
    });
  };
}

const registries = new Map<string, SidecarSessionRegistry>();
const brokers = new Map<string, SidecarBroker>();
const connectionServices = new Map<string, ConnectionService>();

/**
 * The workspace's connections, read from its `.n-dx.local.json` on first use
 * and kept for the server's life: a connection added later needs a restart
 * until the Settings page manages them.
 */
function defaultConnectionsFor(projectDir: string): ConnectionService {
  let service = connectionServices.get(projectDir);
  if (!service) {
    service = new ConnectionService({ projectDir });
    connectionServices.set(projectDir, service);
  }
  return service;
}

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

/** `path` as one spelling per directory: symlinks and, where the filesystem folds case, case resolved. */
function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Whether a session stored with `worktree` belongs to `checkout`. The
 * stored spelling is whatever the creating process was started with, so a
 * restart from a symlinked or differently cased path must still match.
 */
function heldBy(checkout: string, worktree: string): boolean {
  return canonicalPath(worktree) === canonicalPath(checkout);
}

/** Build a broker for `dir` that announces its cards through `broadcast`; `ledger` defaults to a worktree's. */
export function createAnnouncingBroker(
  dir: string,
  broadcast: WebSocketBroadcaster,
  ledger?: SidecarLedgerTarget,
  draftsDir?: string,
): SidecarBroker {
  return new SidecarBroker({
    dir,
    ...(ledger && { ledger }),
    ...(draftsDir && { draftsDir }),
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

/**
 * Why a Codex Sidecar session is refused. `codex exec resume` takes its
 * sandbox and approval policy from the invocation's config, not the thread,
 * so from the second turn the user's `~/.codex/config.toml` would decide and
 * the session could write the worktree with no card. Re-applying the policy
 * on resume is PRD item 31307b89; until it lands, Codex is refused at create
 * and at every turn.
 */
export const CODEX_SIDECAR_UNAVAILABLE =
  "Codex Sidecar sessions are unavailable until a resumed turn keeps the read-only sandbox";

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

const HUB_SESSIONS = `${HUB_SIDECAR_API_PREFIX}${HUB_SESSION_ROUTES.sessions}`;
const HUB_DRAWER = `${HUB_SIDECAR_API_PREFIX}${HUB_SESSION_ROUTES.drawer}`;
const HUB_LENS_PATH = `${HUB_SIDECAR_API_PREFIX}${HUB_SESSION_ROUTES.lens}`;
const HUB_SNAPSHOT = `${HUB_SIDECAR_API_PREFIX}${HUB_SESSION_ROUTES.snapshot}`;
const HUB_HANDOFF = `${HUB_SIDECAR_API_PREFIX}${HUB_SESSION_ROUTES.handoff}`;
const HUB_LENS = "hub";

/**
 * What an approved broker call does in the hub session: a fixed read-only
 * command or a GitHub post at one project's repository root, or a saved draft
 * file. Everything else refuses, and no network read runs without a card
 * (`sidecar/hub-actions.ts`).
 */
export function hubSidecarActions(
  ctx: ServerContext,
  opts: HubSidecarRouteOptions = {},
  exec: BranchHealthExec = llmExec,
): SidecarActions {
  // `ndx` is this host's own CLI, as a worktree's Sidecar command resolves it, never a PATH lookup.
  return createHubActions({ homeDir: opts.homeDir, ...(opts.fetch && { fetch: opts.fetch }), exec, ndx: () => resolveNdxBin(ctx) });
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
 * The hub session's ledger: `<ndx home>/hub/ledger.jsonl`, the machine's
 * rather than one session's, written only by the agent's `ledger_append`,
 * which may also record a `decision-needed`.
 */
/** `<ndx home>/hub/drafts/`: where a relative `save_draft` path lands. */
export function hubDraftsDir(hubHome: string): string {
  return join(dirname(hubSidecarDir(hubHome)), "drafts");
}

export function hubLedgerTarget(homeDir?: string): SidecarLedgerTarget {
  const path = hubLedgerPath(resolveHubHome(homeDir));
  return { path: () => path, types: HUB_LEDGER_TYPES };
}

/**
 * Checkpoint wiring for the hub session: the host project's hub ceiling
 * (`web.sidecarContextCeiling.hub`, default 40k, read per turn), the hub
 * ledger (carried by every turn, since every turn carries the packet), and
 * the hub lens's packet rebuilt from a fresh snapshot on every turn.
 */
export function hubSidecarContextOptions(ctx: ServerContext, dir: string, opts: HubSidecarRouteOptions = {}): SidecarContextOptions {
  // The fingerprints of the snapshot each session's latest packet was built
  // from, written only once a turn carrying it completes.
  const pending = new Map<string, () => void>();
  const ledger = hubLedgerTarget(opts.homeDir);
  return {
    ceiling: () => resolveContextCeiling(ctx.projectDir, "hub"),
    ledger: (record) => readLedgerAt(ledger.path(record.id)),
    checkpointPrompt: HUB_CHECKPOINT_PROMPT,
    packetEveryTurn: true,
    packetDelivered: (record) => {
      const commit = pending.get(record.id);
      pending.delete(record.id);
      // The turn reached the model either way. Unsaved fingerprints only make
      // the next turn mark Δ against an older snapshot, so the turn stands.
      try {
        commit?.();
      } catch (err) {
        console.error(`[sidecar] could not save the hub snapshot fingerprints for session ${record.id}: ${errorMessage(err)}`);
      }
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
    const defaults: WorktreeSidecarRegistryOptions = {
      context: hubSidecarContextOptions(ctx, dir, opts),
      ttlMs: () => resolveSidecarIdleMs(ctx.projectDir),
      onTurnSpend: hubTurnSpendRecorder(ctx, opts.homeDir),
    };
    state = {
      registry: opts.registryFor
        ? opts.registryFor(dir, defaults)
        : createHubSidecarRegistry({
            ...defaults,
            dir,
            hostProjectDir: ctx.projectDir,
            broker: (id) => hubSidecarBrokerEndpoint(ctx, id),
          }),
      broker: opts.brokerFor ? opts.brokerFor(dir) : createAnnouncingBroker(dir, broadcast, hubLedgerTarget(opts.homeDir), hubDraftsDir(resolveHubHome(opts.homeDir))),
    };
    hubHosts.set(key, state);
  }
  return state;
}

/** Whether `pathname` is one of the hub session's routes, `/api/sidecar/hub[/…]`. */
export function isHubSidecarPath(pathname: string): boolean {
  return pathname === HUB_SIDECAR_API_PREFIX || pathname.startsWith(`${HUB_SIDECAR_API_PREFIX}/`);
}

/** Releases already waiting on a hub turn, by host key, so repeated refusals share one. */
const hubReleases = new Map<string, Promise<boolean>>();

/**
 * Give up the hub session host lock because web.sidecar is off on this
 * server: its route gate refused a `/api/sidecar/hub/*` request, and the hub
 * has moved on to another project. A hub turn still running here finishes
 * first, and the lock stays held until it does, so no other host resumes
 * the session under it. Released only if the feature is still off then.
 *
 * @returns true when this call removed the lock.
 */
export function releaseHubSessionHostForSidecarOff(ctx: ServerContext, opts: Pick<HubSidecarRouteOptions, "homeDir" | "pid"> = {}): Promise<boolean> {
  if (!ctx.port) return Promise.resolve(false);
  const port = ctx.port;
  const home = resolveHubHome(opts.homeDir);
  const pid = opts.pid ?? process.pid;
  const key = `${hubSidecarDir(home)}\0${pid}`;
  const pending = hubReleases.get(key);
  if (pending) return pending;
  const release = (async () => {
    await hubHosts.get(key)?.registry.whenIdle();
    if (isFeatureEnabled(ctx.projectDir, HUB_SESSION_FEATURE)) return false;
    return releaseHubSessionHost(home, { pid, port });
  })().finally(() => hubReleases.delete(key));
  hubReleases.set(key, release);
  return release;
}

/** Host keys whose server is shutting down: their hub session routes refuse, so nothing claims the lock again or starts a turn. */
const hubShuttingDown = new Set<string>();

/** How long shutdown waits for an interrupted hub turn to settle before it leaves the lock to dead-pid takeover. */
export const HUB_SHUTDOWN_TURN_WAIT_MS = 5_000;

/**
 * Give up the hub session host lock on shutdown. Hub session routes on this
 * server refuse from now on; its running hub turns are interrupted, and the
 * lock goes only once they have settled, so no other host resumes the
 * session while a turn here still writes it. A turn that outlasts `waitMs`
 * keeps the lock, which the next host takes once this process has exited.
 * A lock another server holds is left alone.
 *
 * @returns true when this call removed the lock.
 */
export async function releaseHubSessionHostOnShutdown(
  port: number,
  opts: Pick<HubSidecarRouteOptions, "homeDir" | "pid"> & { waitMs?: number } = {},
): Promise<boolean> {
  const home = resolveHubHome(opts.homeDir);
  const pid = opts.pid ?? process.pid;
  const key = `${hubSidecarDir(home)}\0${pid}`;
  hubShuttingDown.add(key);
  const registry = hubHosts.get(key)?.registry;
  if (registry) {
    await registry.interruptAll();
    let timer: NodeJS.Timeout | undefined;
    const settled = await Promise.race([
      registry.whenIdle().then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), opts.waitMs ?? HUB_SHUTDOWN_TURN_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    if (!settled) return false;
  }
  return releaseHubSessionHost(home, { pid, port });
}

/**
 * Where the drawer page reaches the hub session, and what it posts to close.
 * Mirrored by `HubSessionPageConfig` in viewer/hooks/use-hub-session.ts.
 *
 * The page is served here, so the paths ride in with it rather than through
 * the viewer's gateway: the hub owns them (`src/shared/base-path.ts`), and the
 * page needs them nowhere else.
 */
export interface HubSessionPageConfig {
  sessions: string;
  lens: string;
  snapshot: string;
  /** POST `{ project, worktree }`: "Open in worktree sidecar". */
  handoff: string;
  /** The WebSocket path: the hub forwards an upgrade under it to the host. */
  socket: string;
  closeMessage: string;
}

export const HUB_SESSION_PAGE_CONFIG_ID = "hub-session-config";

export function hubSessionPageConfig(): HubSessionPageConfig {
  return {
    sessions: `${HUB_SESSION_PATH}${HUB_SESSION_ROUTES.sessions}`,
    lens: `${HUB_SESSION_PATH}${HUB_SESSION_ROUTES.lens}`,
    snapshot: `${HUB_SESSION_PATH}${HUB_SESSION_ROUTES.snapshot}`,
    handoff: `${HUB_SESSION_PATH}${HUB_SESSION_ROUTES.handoff}`,
    socket: HUB_SESSION_PATH,
    closeMessage: HUB_SESSION_CLOSE_MESSAGE,
  };
}

/** The drawer page with its config as a JSON block ahead of the app root. `<` is escaped so the JSON cannot close the script. */
function withHubSessionPageConfig(html: string): string {
  const json = JSON.stringify(hubSessionPageConfig()).replace(/</g, "\\u003c");
  const block = `<script type="application/json" id="${HUB_SESSION_PAGE_CONFIG_ID}">${json}</script>`;
  return html.includes("<body") ? html.replace(/<body([^>]*)>/, (tag) => `${tag}${block}`) : `${block}${html}`;
}

/** `GET /api/sidecar/hub/lens`: whether this server can run the hub lens, and the hub ceiling it would hold the session to. */
export interface HubLensResponse {
  lens: { id: string; available: boolean; needs?: string };
  ceiling: number;
}

/** The hub lens on this server: unavailable while its feature is off here, read per request like every gate. */
function hubLensInfo(ctx: ServerContext): HubLensResponse["lens"] {
  const plan = LENS_PACKETS[HUB_LENS];
  if (plan.kind !== "packet") return { id: HUB_LENS, available: false, ...(plan.kind === "unavailable" && { needs: plan.needs }) };
  if (plan.feature && !isFeatureEnabled(ctx.projectDir, plan.feature.key)) {
    return { id: HUB_LENS, available: false, needs: plan.feature.needs };
  }
  return { id: HUB_LENS, available: true };
}

/**
 * `GET /api/sidecar/hub/snapshot`: how many snapshot items the open session's
 * next turn marks Δ. Built like the turn's packet but never committed, so
 * reading it moves nothing. `changed` is null with no open session, before
 * its first delivered turn, or with `error` naming why there is no snapshot.
 */
export interface HubSnapshotDeltaResponse {
  session: string | null;
  changed: number | null;
  omitted?: number;
  generatedAt?: string;
  error?: string;
  /** The worktrees the snapshot read, each one a drawer row with "Open in worktree sidecar". */
  worktrees?: HubSnapshotWorktreeRef[];
}

async function hubSnapshotDelta(
  registry: SidecarSessionRegistry,
  dir: string,
  opts: HubSidecarRouteOptions,
): Promise<HubSnapshotDeltaResponse> {
  const open = openHubSession(registry);
  if (!open) return { session: null, changed: null };
  // Before a turn has delivered one there is nothing to be Δ against: the
  // first turn reads the snapshot whole. Until then nothing is asked either,
  // so there is no question to hand off and no row to offer it on.
  if (!hasHubSnapshotBaseline(dir, open.id)) return { session: open.id, changed: null };
  const read = await hubSnapshotReader(dir, open.id, { homeDir: opts.homeDir, ...(opts.fetch && { fetch: opts.fetch }) })();
  if (typeof read === "string") return { session: open.id, changed: null, error: read };
  return { session: open.id, changed: read.changed.length, omitted: read.omitted, generatedAt: read.generatedAt, worktrees: read.worktrees };
}

/** `POST /api/sidecar/hub/handoff`: the worktree session the hub's question went to, and the address that opens its drawer. */
export interface HubHandoffResponse extends SidecarHandoffResponse {
  url: string;
}

/** The operator's latest message to the hub session: the question a handoff names. */
function latestHubQuestion(registry: SidecarSessionRegistry, id: string): string | null {
  const frames = registry.readFrames(id);
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i]!;
    if (frame.type === "user") return frame.text;
  }
  return null;
}

/**
 * "Open in worktree sidecar": hand the open hub session's latest question to
 * the worktree `{ project, worktree }` names, through the hub. The hub ledger
 * is not written: that is the agent's, through `ledger_append`.
 */
async function hubHandoff(
  req: IncomingMessage,
  res: ServerResponse,
  registry: SidecarSessionRegistry,
  opts: HubSidecarRouteOptions,
): Promise<true> {
  const body = await readJsonObject(req, res);
  if (typeof body === "string") return refuse(res, 400, body);
  const project = optionalString(body, "project");
  const worktree = optionalString(body, "worktree");
  if (typeof project !== "string" || typeof worktree !== "string") {
    return refuse(res, 400, `"project" and "worktree" must name a project id and one of its workspace keys`);
  }
  const open = openHubSession(registry);
  if (!open) return refuse(res, 409, "There is no open hub session to hand off from");
  const question = latestHubQuestion(registry, open.id);
  if (!question) return refuse(res, 409, "Ask the hub session something first: a handoff names the hub's question");
  const access = resolveHubAccess(opts.homeDir);
  if (!access) return refuse(res, 503, "No hub is running (no hub pid file names a port)");
  const handed = await handOffToWorktree(access, { project, worktree, question, vendor: open.vendor }, opts.fetch ? { fetch: opts.fetch } : {});
  if (!handed.ok) return refuse(res, handed.status, handed.error);
  jsonResponse(res, 200, { session: handed.session, created: handed.created, url: handed.url } satisfies HubHandoffResponse);
  return true;
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
  const method = req.method || "GET";
  // Read by any project server, host or not: what the page and the hub home need before a session exists.
  if (pathname === HUB_DRAWER || pathname === HUB_LENS_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    if (pathname === HUB_LENS_PATH) {
      jsonResponse(res, 200, { lens: hubLensInfo(ctx), ceiling: resolveContextCeiling(ctx.projectDir, "hub") } satisfies HubLensResponse);
      return true;
    }
    const html = opts.drawerHtml?.() ?? null;
    if (html === null) return refuse(res, 404, "The hub session drawer is not built; run the web package's build");
    // The hub home docks this page in an iframe; the gate's DENY would blank it.
    // The hub forwards these headers over its own.
    applySameOriginFramePolicy(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    // The session script signs the frame in from its tab, so its fetches carry the credential and its socket a ticket.
    res.end(injectSessionScript(withHubSessionPageConfig(html)));
    return true;
  }
  if (!ctx.port) return refuse(res, 503, "This server has no port, so it cannot host the hub session");
  const home = resolveHubHome(opts.homeDir);
  const dir = hubSidecarDir(home);
  const pid = opts.pid ?? process.pid;
  if (hubShuttingDown.has(`${dir}\0${pid}`)) return refuse(res, 503, "This server is shutting down; the hub session moves to another project server");
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
  if (pathname === HUB_SNAPSHOT) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    jsonResponse(res, 200, await hubSnapshotDelta(registry, dir, opts));
    return true;
  }
  if (pathname === HUB_HANDOFF) {
    if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${pathname}`);
    return hubHandoff(req, res, registry, opts);
  }
  return handleSessionRoutes(req, res, pathname, search, {
    prefix: HUB_SESSIONS,
    worktree: dir,
    registry,
    broker,
    broadcast,
    actions: () => opts.actions ?? hubSidecarActions(ctx, opts, opts.exec),
    brokerScope: "hub",
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
  if (isHubSidecarPath(pathname)) {
    return handleHubSidecarRoute(req, res, ctx, broadcast, opts.hub, pathname, search);
  }
  if (
    pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)
    && pathname !== ALLOW_LIST_PATH && pathname !== SETTINGS_PATH && pathname !== LENSES_PATH && pathname !== PROPOSALS_PATH
    && pathname !== SIDECAR_LEDGER_LATEST_PATH && pathname !== SIDECAR_HANDOFF_PATH
  ) {
    return false;
  }
  const method = req.method || "GET";
  const registry = opts.registryFor ? opts.registryFor(ctx.projectDir) : defaultRegistryFor(ctx, opts.workspaces);
  const broker = opts.brokerFor ? opts.brokerFor(ctx.projectDir) : defaultBrokerFor(ctx.projectDir, broadcast);

  if (pathname === LENSES_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${LENSES_PATH}`);
    jsonResponse(res, 200, { lenses: await sidecarLenses(ctx) });
    return true;
  }

  if (pathname === PROPOSALS_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${PROPOSALS_PATH}`);
    jsonResponse(res, 200, { cards: broker.proposals() });
    return true;
  }

  if (pathname === SIDECAR_LEDGER_LATEST_PATH) {
    if (method !== "GET") return refuse(res, 405, `${method} is not supported on ${SIDECAR_LEDGER_LATEST_PATH}`);
    jsonResponse(res, 200, latestSessionNotes(registry, ctx.projectDir));
    return true;
  }

  if (pathname === SIDECAR_HANDOFF_PATH) {
    if (method !== "POST") return refuse(res, 405, `${method} is not supported on ${SIDECAR_HANDOFF_PATH}`);
    const body = await readJsonObject(req, res);
    if (typeof body === "string") return refuse(res, 400, body);
    const handed = receiveHandoff(registry, broker, ctx.projectDir, body);
    if ("error" in handed) return refuse(res, handed.status, handed.error);
    jsonResponse(res, handed.created ? 201 : 200, handed);
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
    connections: () => (opts.connectionsFor ? opts.connectionsFor(ctx.projectDir) : defaultConnectionsFor(ctx.projectDir)),
    create: (body) => createWorktreeSession(registry, ctx.projectDir, body),
    readPlacementEdit: (placement, edits, reviewed) => readPlacementEdit(ctx.rexDir, placement, edits, reviewed),
  });
}

/** The notes the hub snapshot shows per worktree session. */
const SNAPSHOT_NOTE_TYPES = ["unfinished", "decision"] as const;

/** `GET /api/sidecar/ledger/latest`: each open session's latest unfinished and decision notes, sessions with neither left out. */
function latestSessionNotes(registry: SidecarSessionRegistry, worktree: string): SidecarLedgerLatestResponse {
  const dir = worktreeSidecarDir(worktree);
  const sessions = registry.list({ scope: "worktree" })
    .filter((session) => heldBy(worktree, session.worktree))
    .filter((session) => !session.endedAt)
    .flatMap((session) => {
      const latest = latestLedgerEntries(readLedger(dir, session.id), SNAPSHOT_NOTE_TYPES);
      return latest.unfinished || latest.decision ? [{ id: session.id, name: session.name, ...latest }] : [];
    });
  return { sessions };
}

/** The open session a handoff resumes: the worktree's most recently active one that has not ended. */
function latestOpenSession(registry: SidecarSessionRegistry, worktree: string): SidecarSessionRecord | undefined {
  return registry.list({ scope: "worktree" })
    .filter((session) => heldBy(worktree, session.worktree))
    .filter((session) => !session.endedAt)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
}

/** The handoff entry: the hub's question, cut to the ledger's entry cap. */
function handoffText(question: string): string {
  const text = `The hub session handed this over. Its question: ${question.replace(/\s+/g, " ").trim()}`;
  return text.length <= LEDGER_ENTRY_MAX_CHARS ? text : `${text.slice(0, LEDGER_ENTRY_MAX_CHARS - 1)}…`;
}

/**
 * `POST /api/sidecar/handoff { question, vendor }`, which the hub session's
 * "Open in worktree sidecar" sends through the hub: resume this worktree's
 * latest open session, or create one on `vendor`, leave a `handoff` entry
 * naming the question in its ledger, and make its next turn carry the ledger.
 */
function receiveHandoff(
  registry: SidecarSessionRegistry,
  broker: SidecarBroker,
  worktree: string,
  body: Record<string, unknown>,
): SidecarHandoffResponse | { status: 400; error: string } {
  const question = optionalString(body, "question");
  if (typeof question !== "string") return { status: 400, error: `"question" must be a non-empty string` };
  let session = latestOpenSession(registry, worktree);
  const created = !session;
  if (!session) {
    const made = createWorktreeSession(registry, worktree, { vendor: body.vendor, name: "From the hub" });
    if ("error" in made) return { status: 400, error: made.error };
    session = made.session;
  }
  broker.appendHandoff(session.id, handoffText(question));
  registry.carryContextNext(session.id);
  return { session: { id: session.id, name: session.name }, created };
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
  /** Which tools the session's broker offers; a worktree's by default. */
  brokerScope?: BrokerScope;
  /** The connections whose tools the broker re-exposes; absent where none are offered (the hub). */
  connections?: () => BrokerConnections;
  create: (body: Record<string, unknown>) => CreateAnswer;
  /** The one lens this scope's sessions run; a PATCH to another, or to a target, is refused. */
  lens?: string;
  /** Dry-runs an edited placement; absent where no placement card is offered (the hub). */
  readPlacementEdit?: (placement: Parameters<typeof readPlacementEdit>[1], edits: unknown, reviewed: unknown) => ReturnType<typeof readPlacementEdit>;
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
    return { status: 400, error: `"vendor" must be a vendor with a resumable CLI session (claude)` };
  }
  if (vendor === "codex") return { status: 400, error: CODEX_SIDECAR_UNAVAILABLE };
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
      const sessions = registry.list()
        .filter((session) => heldBy(scope.worktree, session.worktree))
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
  if (!session || !heldBy(scope.worktree, session.worktree)) return refuse(res, 404, `No Sidecar session ${id}`);

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
      // A Codex session indexed before the create refusal must not resume without its sandbox.
      if (session.vendor === "codex") return refuse(res, 409, CODEX_SIDECAR_UNAVAILABLE);
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
      if (body.path !== undefined && typeof body.path !== "string") return refuse(res, 400, `"path" must be a string`);
      // A placement card's edit is a placement: dry-run it, against the dry run the operator reviewed, before the card is touched.
      const waiting = broker.cards(id).find((c) => c.id === cardId);
      let placementEdit: Exclude<Awaited<ReturnType<typeof readPlacementEdit>>, PlacementEditRefusal> | undefined;
      if (body.edits !== undefined && body.decision === "approve" && waiting?.placement && scope.readPlacementEdit) {
        const read = await scope.readPlacementEdit(waiting.placement, body.edits, body.reviewed);
        if ("error" in read) return refuse(res, read.status, read.error);
        placementEdit = read;
      }
      try {
        const card = broker.decide(id, cardId, {
          approve: body.decision === "approve",
          ...(reason && { reason }),
          ...(body.remember && { remember: true }),
          ...(placementEdit ? { placement: placementEdit } : body.edits !== undefined && { edits: body.edits }),
          ...(body.lane !== undefined && { lane: body.lane }),
          ...(body.path !== undefined && { path: body.path }),
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
      await handleBrokerMcpRequest(req, res, broker, id, scope.actions(), scope.brokerScope, scope.connections?.());
      return true;
  }
  return false;
}
