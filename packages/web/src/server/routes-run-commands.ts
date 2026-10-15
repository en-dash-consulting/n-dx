/**
 * Run and build the project from the dashboard.
 *
 * `GET /api/run-commands` lists what was detected plus the current job;
 * `POST /api/run-commands/start` runs one by id; `/status` polls it; `/stop`
 * interrupts it.
 *
 * ## Why this cannot run arbitrary commands
 *
 * The caller names an **id** from the detected list and nothing else. The
 * executable and *all* of its arguments come from `detectCommands()` on this
 * side, and the spawn uses no shell.
 *
 * There is deliberately no way to pass extra arguments. An earlier revision
 * allowed them on the reasoning that, without a shell, an argument is only
 * ever one literal argv entry — which is true and beside the point: flags are
 * the attack surface. `make --eval='$(shell ...)'` and
 * `cargo --config build.rustc-wrapper=...` both execute an arbitrary program
 * with no shell and no file on disk. A per-tool allowlist of safe flags would
 * be a guess that silently stops being true when a tool adds one, so the
 * control runs a detected command exactly as detected.
 *
 * ## Why this spawns through `spawnCli`
 *
 * The commands here are package-manager entry points, and on Windows `npm`,
 * `pnpm` and `yarn` are `.cmd` shims that `spawn` cannot launch directly
 * (GH #37, EINVAL). `spawnCli` is the repo's Windows-safe spawn, and
 * `terminateProcessTree` is what makes Stop reach the dev server underneath
 * the shim rather than only the shim itself.
 *
 * ## Why a run has no timeout
 *
 * A dev server is supposed to stay up. Build commands finish on their own and
 * get a ceiling; `kind: "run"` entries get none and end when the process ends
 * or an operator presses Stop.
 *
 * @module web/server/routes-run-commands
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnCli, terminateProcessTree } from "@n-dx/llm-client";

import type { ServerContext } from "./types.js";
import { WorkspaceScoped } from "./workspace-scoped.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import {
  detectCommands,
  findLocalUrl,
  type DetectedCommand,
} from "./run-command-detect.js";

/** How much of a process's output is kept for the panel. */
const MAX_OUTPUT_BYTES = 20_000;

/** Ceiling for a command that is supposed to finish. */
const BUILD_TIMEOUT_MS = 600_000;

export interface RunCommandStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Id of the command this job is, or was last, running. */
  commandId: string | null;
  label: string | null;
  kind: "run" | "build" | null;
  /** Tail of combined stdout and stderr. */
  output: string;
  exitCode: number | null;
  error: string | null;
  /** True when the last run ended because an operator pressed Stop. */
  stopped: boolean;
  /** Localhost URL the process advertised, once it has advertised one. */
  url: string | null;
}

interface RunJobSlot {
  status: RunCommandStatus;
  // Derived from spawnCli rather than imported from node:child_process:
  // the architecture policy keeps process execution behind the foundation
  // tier, and a type-only import would still breach it.
  child: ReturnType<typeof spawnCli> | null;
  stopRequested: boolean;
}

function emptyStatus(): RunCommandStatus {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    commandId: null,
    label: null,
    kind: null,
    output: "",
    exitCode: null,
    error: null,
    stopped: false,
    url: null,
  };
}

// One run per workspace: worktree A's dev server must not block or report in
// worktree B, matching how every other job on this surface is scoped.
const runSlots = new WorkspaceScoped<RunJobSlot>(() => ({
  status: emptyStatus(),
  child: null,
  stopRequested: false,
}));

function slotFor(ctx: ServerContext): RunJobSlot {
  return runSlots.get(ctx);
}

function handleList(res: ServerResponse, ctx: ServerContext): boolean {
  jsonResponse(res, 200, {
    commands: detectCommands(ctx.projectDir),
    status: slotFor(ctx).status,
  });
  return true;
}

function handleStatus(res: ServerResponse, ctx: ServerContext): boolean {
  jsonResponse(res, 200, slotFor(ctx).status);
  return true;
}

function handleStop(res: ServerResponse, ctx: ServerContext): boolean {
  const slot = slotFor(ctx);
  if (!slot.status.running || !slot.child) {
    jsonResponse(res, 409, { error: "No command is running" });
    return true;
  }
  slot.stopRequested = true;
  // Tree-kill, not child.kill: on Windows the direct child is the `.cmd`
  // shim's cmd.exe, and killing it would orphan the dev server underneath,
  // leaving the port held. terminateProcessTree gives a grace period before
  // escalating, so a server still gets to close its listeners.
  void terminateProcessTree(slot.child).catch(() => {
    // Already gone, or we cannot reach it; `done` still settles the status.
  });
  jsonResponse(res, 200, { ok: true, message: "Stop requested." });
  return true;
}

async function handleStart(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let id: string;
  try {
    const input = JSON.parse(await readBody(req, res)) as { id?: unknown };
    if (typeof input.id !== "string" || !input.id) {
      errorResponse(res, 400, "id is required");
      return true;
    }
    id = input.id;
  } catch {
    errorResponse(res, 400, "Invalid JSON body");
    return true;
  }

  // The id is resolved against this side's detection. A binary never arrives
  // from the caller, so there is nothing here to inject into.
  const command: DetectedCommand | undefined = detectCommands(ctx.projectDir)
    .find((c) => c.id === id);
  if (!command) {
    errorResponse(res, 404, `No detected command with id "${id}"`);
    return true;
  }

  const slot = slotFor(ctx);
  if (slot.status.running) {
    jsonResponse(res, 409, {
      error: `"${slot.status.label}" is already running. Stop it first.`,
    });
    return true;
  }

  const status: RunCommandStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    commandId: command.id,
    label: command.label,
    kind: command.kind,
    output: "",
    exitCode: null,
    error: null,
    stopped: false,
    url: null,
  };
  slot.status = status;
  slot.stopRequested = false;

  jsonResponse(res, 202, {
    ok: true,
    startedAt: status.startedAt,
    label: status.label,
    message: "Started. Poll /api/run-commands/status for progress.",
  });

  const append = (chunk: string): void => {
    status.output = (status.output + chunk).slice(-MAX_OUTPUT_BYTES);
    // Look for the served URL only until one is found: a later line echoing
    // a different port should not move a link the user may already have open.
    if (!status.url) status.url = findLocalUrl(status.output);
  };

  const child = spawnCli(command.bin, command.args, {
    cwd: ctx.projectDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  slot.child = child;

  child.stdout?.on("data", (chunk: Buffer) => append(chunk.toString()));
  // Dev servers routinely announce their URL on stderr, so it is folded into
  // the same output rather than discarded.
  child.stderr?.on("data", (chunk: Buffer) => append(chunk.toString()));

  // Only a command that is meant to finish gets a ceiling; a run serves until
  // it is stopped.
  const buildTimer = command.kind === "build"
    ? setTimeout(() => {
        slot.stopRequested = true;
        status.error = `Timed out after ${Math.round(BUILD_TIMEOUT_MS / 1000)}s`;
        void terminateProcessTree(child).catch(() => {});
      }, BUILD_TIMEOUT_MS)
    : null;

  const settle = (exitCode: number | null, spawnError: Error | null): void => {
    if (buildTimer) clearTimeout(buildTimer);
    if (!status.running) return;
    const wasStopped = slot.stopRequested;
    status.running = false;
    status.finishedAt = new Date().toISOString();
    status.exitCode = exitCode;
    status.stopped = wasStopped && !status.error;
    if (spawnError) {
      // Nearly always a missing binary, which is worth saying plainly rather
      // than leaving as a bare errno.
      status.error = `Could not run ${command.bin}: ${spawnError.message}`;
    } else if (!status.error && !wasStopped && exitCode !== 0) {
      // A stop is a normal outcome, not a failure, even though the process
      // was killed and exits non-zero.
      status.error = `Exited with code ${exitCode ?? "unknown"}`;
    }
    slot.child = null;
    slot.stopRequested = false;
  };

  child.on("error", (err: Error) => settle(null, err));
  child.on("close", (code: number | null) => settle(code, null));

  return true;
}

/** Handle /api/run-commands requests. Returns true if handled. */
export async function handleRunCommandsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const path = new URL(req.url || "/", "http://localhost").pathname;
  const method = req.method || "GET";

  if (!path.startsWith("/api/run-commands")) return false;

  if (path === "/api/run-commands" && method === "GET") return handleList(res, ctx);
  if (path === "/api/run-commands/status" && method === "GET") return handleStatus(res, ctx);
  if (path === "/api/run-commands/start" && method === "POST") return handleStart(req, res, ctx);
  if (path === "/api/run-commands/stop" && method === "POST") return handleStop(res, ctx);

  return false;
}

/**
 * Terminate every run this process started, across all workspaces.
 *
 * Called from the dashboard's shutdown sequence. A run command has no timeout
 * — a dev server is meant to stay up — so without this a Ctrl-C leaves the
 * child alive holding its port, and the restarted server has no handle to it:
 * Stop answers 409 and Start cannot bind.
 */
export async function shutdownRunCommands(): Promise<{ terminated: number }> {
  let terminated = 0;
  for (const slot of runSlots.values()) {
    if (!slot.status.running || !slot.child) continue;
    slot.stopRequested = true;
    try {
      await terminateProcessTree(slot.child);
      terminated += 1;
    } catch {
      // Already gone, or beyond reach; shutdown continues either way.
    }
    slot.child = null;
    slot.status.running = false;
  }
  return { terminated };
}

/** Test seam: forget every workspace's job between cases. */
export function resetRunCommandJobs(): void {
  runSlots.clear();
}
