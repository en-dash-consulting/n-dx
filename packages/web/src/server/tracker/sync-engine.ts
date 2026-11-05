/**
 * Tracker sync, executed by the project server: queued ndx events through the
 * rules (rules.ts) into the activity log (activity-log.ts), and the calls a
 * rule that is `on` makes through the project's own connection service.
 *
 * The hub only keeps time: it POSTs `/api/tracker/sync/tick`, which runs
 * {@link runTrackerSyncTick} over the events queued since the last tick.
 *
 * - An event whose request id the log has settled (ok, duplicate, refused,
 *   card) is never planned again, so a refused call is not retried, with the
 *   same arguments or other ones.
 * - A create or duplicate reply is confirmed with the profile's read tool
 *   before it is logged.
 * - A refusal logs its problems list as the tracker gave it.
 * - An unreachable connection, or one that needs sign-in, logs that and keeps
 *   the event queued for the next tick, unchanged.
 *
 * See docs/architecture/sidecar-connections.md.
 */

import { McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SidecarCallProblem } from "../../shared/index.js";
import { ConnectionUnavailableError, type ConnectionService } from "../connections/connection-service.js";
import { errorMessage } from "../response-utils.js";
import { callProblems, resultData } from "../sidecar/external-call.js";
import { appendTrackerActivity, readTrackerActivity, SETTLED_RESULTS, type TrackerActivityEntry, type TrackerResult } from "./activity-log.js";
import { planTrackerEvent, type PlannedCall, type TrackerEventRecord } from "./rules.js";
import { checkServerProfile, loadServerProfile, type ProfileOptions, type ServerProfile, type TrackerMapping } from "./server-profiles.js";
import { loadTrackerSync, type TrackerSyncConfig } from "./sync-config.js";

/** The connection service calls sync makes. */
export type TrackerSyncService = Pick<ConnectionService, "callTool" | "listTools" | "callContext">;

export interface TrackerSyncOptions {
  projectDir: string;
  service: TrackerSyncService;
  /** The clock for `at` (tests). */
  now?: () => Date;
  /** Where user profiles are read from (tests). */
  profiles?: ProfileOptions;
}

export type TrackerTickResult =
  /** The project declares no sync settings; the queue is dropped. */
  | { state: "off" }
  /** The settings or the profile cannot be used; the queue is kept. */
  | { state: "invalid"; problems: string[] }
  | { state: "ran"; entries: TrackerActivityEntry[]; queued: number };

/** The most events a project holds between ticks; the oldest give way. */
export const MAX_QUEUED_EVENTS = 500;

const queues = new Map<string, TrackerEventRecord[]>();

/** Queue `record` for `projectDir`'s next tick. */
export function enqueueTrackerEvent(projectDir: string, record: TrackerEventRecord): void {
  const queue = queues.get(projectDir) ?? [];
  queue.push(record);
  if (queue.length > MAX_QUEUED_EVENTS) queue.splice(0, queue.length - MAX_QUEUED_EVENTS);
  queues.set(projectDir, queue);
}

/** The events waiting for `projectDir`'s next tick, oldest first. */
export function queuedTrackerEvents(projectDir: string): readonly TrackerEventRecord[] {
  return [...(queues.get(projectDir) ?? [])];
}

function takeQueue(projectDir: string): TrackerEventRecord[] {
  const queue = queues.get(projectDir) ?? [];
  queues.delete(projectDir);
  return queue;
}

/** Put events back ahead of any queued meanwhile. */
function requeue(projectDir: string, records: TrackerEventRecord[]): void {
  if (records.length === 0) return;
  const queued = queues.get(projectDir) ?? [];
  queues.set(projectDir, [...records, ...queued].slice(-MAX_QUEUED_EVENTS));
}

type Outcome = { result: TrackerResult; problems?: SidecarCallProblem[] };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A tool result's text, for a refusal that carries no problems list. */
function resultText(result: CallToolResult): string {
  return (result.content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** Whether a reply says the tracker already holds this request. */
function isDuplicateReply(data: unknown): boolean {
  return isRecord(data) && (data.duplicate === true || (typeof data.error === "string" && /^duplicate/i.test(data.error)));
}

function unavailable(err: ConnectionUnavailableError): Outcome {
  return { result: err.status.state === "needs-sign-in" ? "needs-sign-in" : "unavailable", problems: [{ message: err.message }] };
}

/** `service.callTool`, with a connection failure or a protocol error as an outcome. */
async function call(
  service: TrackerSyncService,
  connection: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ reply: CallToolResult } | { outcome: Outcome }> {
  try {
    return { reply: await service.callTool(connection, tool, args) };
  } catch (err) {
    if (err instanceof ConnectionUnavailableError) return { outcome: unavailable(err) };
    // The server answered, but not with a result: a refusal of these arguments.
    if (err instanceof McpError) return { outcome: { result: "refused", problems: [{ message: errorMessage(err) }] } };
    throw err;
  }
}

/**
 * Make `planned` on `connection` and say what became of it. A create reply,
 * and any duplicate reply, is confirmed with `mapping.readTool` on the work
 * item it names before it counts.
 */
export async function executeTrackerCall(
  service: TrackerSyncService,
  connection: string,
  mapping: TrackerMapping,
  planned: PlannedCall,
): Promise<Outcome> {
  const made = await call(service, connection, planned.tool, planned.args);
  if ("outcome" in made) return made.outcome;
  const result = made.reply;
  const data = resultData(result);
  const duplicate = isDuplicateReply(data);
  if (result.isError && !duplicate) {
    const problems = callProblems(result);
    return { result: "refused", problems: problems.length > 0 ? problems : [{ message: resultText(result) || "the tracker refused the call" }] };
  }

  const created = planned.tool === mapping.createTool;
  if (!created && !duplicate) return { result: "ok" };
  const replied = isRecord(data) ? (data[mapping.itemIdProperty] ?? data.id) : undefined;
  const itemId = created ? replied : planned.args[mapping.itemIdProperty];
  const outcome: TrackerResult = duplicate ? "duplicate" : "ok";
  if (typeof itemId !== "string" || itemId === "") {
    return { result: "refused", problems: [{ message: `the ${outcome} reply names no work item to confirm with ${mapping.readTool}` }] };
  }
  const read = await call(service, connection, mapping.readTool, { [mapping.itemIdProperty]: itemId });
  if ("outcome" in read) return read.outcome;
  if (read.reply.isError) {
    return { result: "refused", problems: [{ message: `${mapping.readTool} could not confirm ${itemId}: ${resultText(read.reply)}` }] };
  }
  return { result: outcome };
}

interface Ready {
  config: TrackerSyncConfig;
  mapping: TrackerMapping;
  profile: ServerProfile;
}

/** The settings and the profile's mapping, or why sync cannot run. */
function prepare(options: TrackerSyncOptions): Ready | Exclude<TrackerTickResult, { state: "ran" }> {
  const config = loadTrackerSync(options.projectDir);
  if (!config) return { state: "off" };
  if ("problems" in config) return { state: "invalid", problems: config.problems };
  const context = options.service.callContext(config.connection);
  if (!context) return { state: "invalid", problems: [`trackerSync.connection names ${config.connection}, which is not a connection`] };
  const name = config.profile ?? context.profile;
  if (!name) return { state: "invalid", problems: [`connection ${config.connection} names no server profile, and trackerSync.profile is unset`] };
  const profile = loadServerProfile(name, options.profiles);
  if ("problems" in profile) return { state: "invalid", problems: profile.problems };
  if (!profile.tracker) return { state: "invalid", problems: [`profile ${name} maps no tracker`] };
  return { config, mapping: profile.tracker, profile };
}

/**
 * Run every queued event through the rules: log what each plans, and make
 * the calls whose rule is on. Returns the entries this tick logged.
 */
export async function runTrackerSyncTick(options: TrackerSyncOptions): Promise<TrackerTickResult> {
  const { projectDir, service } = options;
  const ready = prepare(options);
  if ("state" in ready) {
    if (ready.state === "off") takeQueue(projectDir);
    return ready;
  }
  const { config, mapping, profile } = ready;
  const now = options.now ?? (() => new Date());
  const settled = new Set(readTrackerActivity(projectDir).filter((e) => SETTLED_RESULTS.has(e.result)).map((e) => e.requestId));
  const pending = takeQueue(projectDir);
  const kept: TrackerEventRecord[] = [];
  const entries: TrackerActivityEntry[] = [];
  let profileProblems: string[] | undefined;

  try {
    while (pending.length > 0) {
      const record = pending[0];
      const plan = planTrackerEvent(record, config, mapping);
      if (plan.action !== "skip" && !settled.has(plan.requestId)) {
        let outcome: Outcome;
        if (plan.action !== "call") {
          outcome = { result: plan.action };
        } else {
          // Checked once per tick, before the first call: a profile that no
          // longer fits its server makes no call.
          if (profileProblems === undefined) {
            const tools = await service.listTools([config.connection]);
            profileProblems = tools.length > 0 ? checkServerProfile(profile, tools) : [];
          }
          outcome = profileProblems.length > 0
            ? { result: "unavailable", problems: profileProblems.map((message) => ({ message })) }
            : await executeTrackerCall(service, config.connection, mapping, plan.call);
        }
        const entry: TrackerActivityEntry = {
          at: now().toISOString(),
          event: record.event,
          rexId: record.rexId,
          rule: plan.rule,
          mode: plan.mode,
          requestId: plan.requestId,
          call: plan.call,
          result: outcome.result,
          ...(outcome.problems && { problems: outcome.problems }),
        };
        appendTrackerActivity(projectDir, entry);
        entries.push(entry);
        if (SETTLED_RESULTS.has(outcome.result)) settled.add(plan.requestId);
        if (outcome.result === "unavailable" || outcome.result === "needs-sign-in") kept.push(record);
      }
      pending.shift();
    }
  } finally {
    // Whatever was not finished, an unexpected error included, waits for the next tick.
    requeue(projectDir, [...kept, ...pending]);
  }
  return { state: "ran", entries, queued: queuedTrackerEvents(projectDir).length };
}
