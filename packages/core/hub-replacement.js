/**
 * Replacing a running hub that is not the one this ndx would start.
 *
 * A hub keeps running across rebuilds and upgrades, so it can be older than
 * the `ndx` that joins it — or, later, started in another authentication mode
 * than the one this command asked for. `ndx start` used to say so and tell the
 * operator to run `ndx hub stop` and start again, which stops every project on
 * the machine and leaves them to be started one by one. It now replaces the
 * hub itself: stop it, start the current build on the same port and home, and
 * bring every project from `hub.json` back on its own `/p/<id>/` URL.
 *
 * What it will not do is cut off live work. An agent run in a registered
 * project, or an MCP session open through the hub, would be interrupted by
 * the restart, so then the replacement is deferred, the operator is told what
 * is in the way and when it will happen, and one flag forces it.
 *
 * This module is the part that decides and words: pure functions, unit-tested
 * without a hub, plus reading hench's lock files from disk. The process work
 * (stopping, spawning, re-registering) is in web.js, beside the rest of the
 * hub lifecycle.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The one flag that replaces a hub now, even with live work on it. */
export const REPLACE_HUB_FLAG = "--replace-hub";

/**
 * Why a running hub should be replaced.
 *
 * @typedef {object} HubReplacementReason
 * @property {"build" | "auth" | "fault"} kind
 *   `build`: older or other build than this ndx starts. `auth`: another
 *   authentication mode than this command asked for. `fault`: it cannot do
 *   part of its job (no n-dx binary or CLI to run).
 * @property {string} text  Says why, as a clause: "the running n-dx hub predates this ndx (…)".
 * @property {"token" | "open"} [wanted]  For `auth`: the mode this command asked for.
 */

/**
 * Work the hub restart would interrupt.
 *
 * @typedef {object} HubLiveWork
 * @property {Array<{ project: string, count: number }>} runs         Agent runs (hench locks, dashboard executions) per project.
 * @property {Array<{ project: string, count: number }>} mcpSessions  MCP sessions open through the hub, per project.
 * @property {Array<{ project: string, count: number }>} [sidecarTurns]  Sidecar turns in progress in each project's own sessions.
 * @property {number} [hubSidecarTurns]  Turns in progress in the hub-scope Sidecar session (hosted by one project server).
 * @property {string[]} [unchecked]  Projects whose live work could not be read ({@link liveWorkAnswer} "unknown").
 */

/**
 * What one project's answer to a live-work probe (`/api/live-work`,
 * `/api/hench/execute/status`, asked through the hub) says. Pure.
 *
 * - "known": a 200 with a body to count from.
 * - "none": nothing on that server can be live — a 404 from a server that
 *   predates the route, or the hub's 503 for a project with no running server.
 * - "unknown": anything else — a timeout, a 5xx, a 401 from a hub holding
 *   another token. That is "could not tell", not "idle", and a replacement
 *   that went ahead on it could cut off an open MCP session or a Sidecar turn.
 *
 * @param {{ status: number, body?: unknown }} res
 * @returns {"known" | "none" | "unknown"}
 */
export function liveWorkAnswer(res) {
  const body = /** @type {{ error?: unknown } | null | undefined} */ (res.body);
  if (res.status === 200 && body && typeof body === "object") return "known";
  if (res.status === 404) return "none";
  if (res.status === 503 && typeof body?.error === "string" && body.error.includes("has no running server")) return "none";
  return "unknown";
}

/** @param {number} pid */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
  }
}

/**
 * The hench runs holding a lock in `henchDir` whose process is alive. Read
 * only: nothing is created or cleaned up, that is hench's business.
 *
 * hench writes `<henchDir>/locks/<pid>.lock` (`{ pid, startedAt, taskId? }`)
 * for the life of every run, from `ndx work` in a terminal and from the
 * dashboard alike.
 *
 * @param {string} henchDir
 * @param {{ isAlive?: (pid: number) => boolean }} [deps]
 * @returns {number}
 */
export function countLiveHenchLocks(henchDir, { isAlive = pidAlive } = {}) {
  let entries;
  try {
    entries = readdirSync(join(henchDir, "locks"));
  } catch {
    return 0;
  }
  let live = 0;
  for (const file of entries) {
    if (!file.endsWith(".lock")) continue;
    try {
      const pid = JSON.parse(readFileSync(join(henchDir, "locks", file), "utf-8"))?.pid;
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) live++;
    } catch {
      // A corrupt lock holds no live process.
    }
  }
  return live;
}

/**
 * "1 agent run (alpha) and 2 open MCP sessions (beta, gamma)", or null when
 * there is nothing. Pure.
 *
 * @param {HubLiveWork} work
 * @returns {string | null}
 */
export function describeLiveWork(work) {
  const part = (entries, one, many) => {
    const live = entries.filter((e) => e.count > 0);
    if (live.length === 0) return null;
    const total = live.reduce((n, e) => n + e.count, 0);
    return `${total} ${total === 1 ? one : many} (${live.map((e) => e.project).join(", ")})`;
  };
  const hubTurns = work.hubSidecarTurns ?? 0;
  const parts = [
    part(work.runs, "agent run", "agent runs"),
    part(work.mcpSessions, "open MCP session", "open MCP sessions"),
    part(work.sidecarTurns ?? [], "Sidecar turn in progress", "Sidecar turns in progress"),
    hubTurns > 0 ? `${hubTurns === 1 ? "a turn" : `${hubTurns} turns`} in progress in the hub's Sidecar` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Whether to replace the hub now or defer, and what to say. Pure.
 *
 * Replaced now when nothing is in the way, or when the operator passed
 * {@link REPLACE_HUB_FLAG}. Deferred otherwise: the note names the reason,
 * the work in the way, when the replacement happens, and the flag. Projects
 * whose live work could not be read (`liveWork.unchecked`) defer it too, and
 * the note names them.
 *
 * @param {object} args
 * @param {HubReplacementReason} args.reason
 * @param {HubLiveWork} args.liveWork
 * @param {boolean} args.force   {@link REPLACE_HUB_FLAG} was given.
 * @param {number} args.port
 * @returns {{ action: "replace", interrupts: string | null } | { action: "defer", note: string }}
 */
export function planHubReplacement({ reason, liveWork, force, port }) {
  const busy = describeLiveWork(liveWork);
  const unchecked = liveWork.unchecked ?? [];
  if (force || (!busy && unchecked.length === 0)) return { action: "replace", interrupts: busy };
  const unknown = unchecked.length === 0 ? null
    : `whether it would interrupt work in ${unchecked.length === 1 ? "project" : `${unchecked.length} projects`} (${unchecked.join(", ")}) could not be checked`;
  const why = busy && unknown ? `Replacing it now would interrupt ${busy}, and ${unknown}`
    : busy ? `Replacing it now would interrupt ${busy}`
    : `${unknown.charAt(0).toUpperCase()}${unknown.slice(1)}`;
  const when = busy ? "The first 'ndx start' after that work ends replaces it" : "The next 'ndx start' checks again";
  return {
    action: "defer",
    note:
      `The n-dx hub on port ${port} needs replacing: ${reason.text}. ` +
      `${why}, so it keeps running for now. ` +
      `${when}; to replace it now anyway, pass ${REPLACE_HUB_FLAG}.`,
  };
}

/**
 * Why this user's hub, running in another authentication mode than this
 * command asked for, is to be replaced. Pure.
 *
 * - An open hub, and this command wants the token: replaced with a token hub,
 *   since joining it would serve this project unauthenticated.
 * - A token hub, and this command asked for none: replaced with an open hub —
 *   only ever because the operator asked for both (`--no-auth` or
 *   `web.auth=false`, and {@link REPLACE_HUB_FLAG}). Without the flag the
 *   project joins the token hub ({@link keptTokenHubNote}).
 * - A hub holding another token than this user's file: replaced with one that
 *   holds this one.
 *
 * @param {"open" | "token" | "mismatch"} state  What the hub is (`hubAuthState` in web.js).
 * @param {"open" | "token"} wanted  What this command asked for.
 * @param {string | null} tokenFile
 * @returns {HubReplacementReason}
 */
export function hubAuthReason(state, wanted, tokenFile) {
  if (state === "open") {
    return { kind: "auth", wanted, text: "it runs without authentication, and this project requires the per-user token" };
  }
  if (state === "token" && wanted === "open") {
    return { kind: "auth", wanted, text: "it requires the per-user token, and this command asked for no authentication" };
  }
  return { kind: "auth", wanted, text: `it was started with a different token than ${tokenFile ?? "this user's"}` };
}

/**
 * Why a hub that reports faults on `/api/hub/health` is to be replaced, or
 * null when it reports none (or predates the field). Pure.
 *
 * A hub with no n-dx binary cannot start project servers, and one with no
 * n-dx CLI cannot serve extensions. The hub does what it can about either on
 * its own (it looks for both beside its own package); what it still lacks,
 * the hub `ndx start` spawns is given on its command line.
 *
 * @param {unknown} faults  The `faults` field of `/api/hub/health`.
 * @returns {HubReplacementReason | null}
 */
export function hubFaultReason(faults) {
  if (!Array.isArray(faults)) return null;
  const parts = [];
  if (faults.includes("no-ndx-bin")) parts.push("it cannot tell which n-dx binary to start project servers from");
  if (faults.includes("no-ndx-cli")) parts.push("it has no n-dx CLI to ask about extensions");
  return parts.length === 0 ? null : { kind: "fault", text: parts.join(", and ") };
}

/**
 * The line printed as a replacement starts. Pure.
 *
 * @param {HubReplacementReason} reason
 * @param {number} port
 * @param {number} projects  How many projects `hub.json` holds.
 * @param {string | null} interrupts  {@link describeLiveWork} of what the forced replacement interrupts.
 * @returns {string}
 */
export function hubReplacementNotice(reason, port, projects, interrupts) {
  const back = projects === 0 ? "It serves no projects yet."
    : projects === 1 ? "Its project comes back on the same /p/<id>/ URL."
    : `Its ${projects} projects come back on the same /p/<id>/ URLs.`;
  const cut = interrupts ? ` This interrupts ${interrupts}, as ${REPLACE_HUB_FLAG} asked.` : "";
  // Turning the token off for every project on the hub is the operator's
  // choice, never ndx's: say whose choice it was and what it means.
  const open = reason.kind === "auth" && reason.wanted === "open"
    ? ` Because this command asked for no authentication (--no-auth, or web.auth=false) and passed ${REPLACE_HUB_FLAG}, the new hub serves every project on it without the token.`
    : "";
  return `Replacing the n-dx hub on port ${port}: ${reason.text}. ${back}${open}${cut}`;
}

/**
 * The outcome of bringing the projects back, as lines to print. Pure.
 *
 * @param {{ healthy: string[], unhealthy: Array<{ id: string, state: string, lastError?: string | null }> }} result
 * @param {number} port
 * @returns {string[]}
 */
export function formatReplacementResult({ healthy, unhealthy }, port) {
  const lines = [];
  if (healthy.length > 0) lines.push(`  Serving again on port ${port}: ${healthy.join(", ")}.`);
  for (const p of unhealthy) {
    lines.push(`  ${p.id} is registered but its server is ${p.state}${p.lastError ? `: ${p.lastError}` : ""}; the hub keeps retrying it.`);
  }
  return lines;
}

/**
 * What the sign-in note says when a hub older than this ndx is still running
 * because its replacement was deferred. Pure.
 *
 * @returns {string}
 */
export function deferredHubSignInFix() {
  return `it is replaced once the work on it ends, or now with ${REPLACE_HUB_FLAG}`;
}

/**
 * What a command that asked for no token says when it joins this user's
 * token hub instead of opening it. Pure.
 *
 * One project's `--no-auth`, or a `web.auth=false` in its local config, does
 * not choose the mode for every project the hub serves — least of all the
 * less safe one. Turning the token off for all of them takes
 * {@link REPLACE_HUB_FLAG} as well.
 *
 * @param {number} port
 * @returns {string}
 */
export function keptTokenHubNote(port) {
  return `The n-dx hub on port ${port} requires the per-user token, so this project is served with it like every other project on that hub. ` +
    `This command asked for no authentication, which does not turn the token off for every project on the hub by itself; pass ${REPLACE_HUB_FLAG} as well to do that.`;
}

/**
 * What a command says when the hub it judged was replaced by another
 * `ndx start` before this one could act, twice over. Pure.
 *
 * @param {number} port
 * @returns {string}
 */
export function changedHubNote(port) {
  return `The n-dx hub on port ${port} was replaced by another ndx start while this one was checking it; this one joins that hub as it is.`;
}

/**
 * Start the hub that takes a stopped one's place, trying a second time when
 * the first start fails. By then the old hub is gone and every project on the
 * machine is down, so a failure is not left as a bare "did not start": it
 * says that `hub.json` is intact and the next `ndx start` brings every
 * project back on its own URL.
 *
 * @template T
 * @param {() => Promise<T>} spawn  Starts the hub and waits for it to answer.
 * @param {{ port: number, projects: number }} where  `projects`: how many `hub.json` holds.
 * @returns {Promise<T>}
 */
export async function spawnReplacementHub(spawn, { port, projects }) {
  try {
    return await spawn();
  } catch {
    // Once more: a slow first start that comes up meanwhile is joined, not raced.
  }
  try {
    return await spawn();
  } catch (err) {
    const back = projects === 0 ? "" : projects === 1
      ? " hub.json still lists its project, and the next 'ndx start' brings it back on its own /p/<id>/ URL."
      : ` hub.json still lists all ${projects} of its projects, and the next 'ndx start' brings every one back on its own /p/<id>/ URL.`;
    throw new Error(`${/** @type {Error} */ (err).message}\nThe old n-dx hub on port ${port} was stopped, and the new one did not start after a second try, so nothing serves that port now.${back}`);
  }
}
