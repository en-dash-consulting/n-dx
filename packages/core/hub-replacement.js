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
 */

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
  const parts = [part(work.runs, "agent run", "agent runs"), part(work.mcpSessions, "open MCP session", "open MCP sessions")]
    .filter(Boolean);
  return parts.length === 0 ? null : parts.join(" and ");
}

/**
 * Whether to replace the hub now or defer, and what to say. Pure.
 *
 * Replaced now when nothing is in the way, or when the operator passed
 * {@link REPLACE_HUB_FLAG}. Deferred otherwise: the note names the reason,
 * the work in the way, when the replacement happens, and the flag.
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
  if (!busy || force) return { action: "replace", interrupts: busy };
  return {
    action: "defer",
    note:
      `The n-dx hub on port ${port} needs replacing: ${reason.text}. ` +
      `Replacing it now would interrupt ${busy}, so it keeps running for now. ` +
      `The first 'ndx start' after that work ends replaces it; to replace it now anyway, pass ${REPLACE_HUB_FLAG}.`,
  };
}

/**
 * Why this user's hub, running in another authentication mode than this
 * command asked for, is to be replaced. Pure.
 *
 * - An open hub, and this command wants the token: replaced with a token hub,
 *   since joining it would serve this project unauthenticated.
 * - A token hub, and this command asked for none: replaced with an open hub —
 *   only ever because the operator asked (`--no-auth`, `web.auth=false`).
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
    ? " Because this command asked for no authentication (--no-auth, or web.auth=false), the new hub serves every project on it without the token."
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
