/**
 * The product map: where the Graview face over this project is running, and
 * starting one beside the dashboard.
 *
 * GET  /api/graview/face — `{ face, enabled, starting, error }`: the running
 *                          face's URL (read, never started, by a GET), whether
 *                          `features.graview.productFace` is on, and how this
 *                          server's own launch is going.
 * POST /api/graview/face — start `ndx graview serve` for this project when the
 *                          flag is on and no face is running. Refused with the
 *                          flag off.
 *
 * The face (`@n-dx/graview-face`'s `bin/serve.js`) records itself in
 * `face.json` in the layout's graview dir once it listens and removes it when
 * it stops; `@n-dx/graview`'s `runningFace` reads the same file. Web cannot
 * import that package (nothing but core does), so the few lines are repeated
 * here and pinned by this route's tests.
 *
 * With the flag on, the server starts a face at startup ({@link startGraviewFaceAtBoot})
 * and stops the one it started at shutdown ({@link shutdownGraviewFace}).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLayout, spawnManaged, type ManagedChild } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./response-utils.js";
import { isFeatureEnabled } from "./routes-features.js";
import { resolveNdxBin } from "./routes-commands.js";
import { featureDisabledBody } from "./route-feature-gates.js";

export const GRAVIEW_FACE_FEATURE = "graview.productFace";
const FACE_FILENAME = "face.json";
const ROUTE = "/api/graview/face";

export interface GraviewFaceStatus {
  /** The running face, or null. */
  face: { url: string } | null;
  /** `features.graview.productFace`. */
  enabled: boolean;
  /** This server started a face that has not listened yet. */
  starting: boolean;
  /** Why this server's last start failed. */
  error: string | null;
}

/** The face serving `graviewDir`, or null: its record, while the process lives. */
export function readRunningFace(graviewDir: string, isAlive: (pid: number) => boolean = processAlive): { url: string; pid: number } | null {
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(join(graviewDir, FACE_FILENAME), "utf-8"));
  } catch {
    return null;
  }
  const { url, pid } = (record ?? {}) as Record<string, unknown>;
  if (typeof url !== "string" || !/^https?:\/\//.test(url) || typeof pid !== "number" || !isAlive(pid)) return null;
  return { url, pid };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface Launch {
  child: ManagedChild;
  /** The face's own pid once it has recorded itself, so shutdown reaches it past `ndx`. */
  facePid?: number;
  exited: boolean;
}

/** One launch per project directory, for this server's lifetime. */
const launches = new Map<string, Launch>();
const lastErrors = new Map<string, string>();

/** Keep the tail of a stream, so an error names the end of the output. */
function tail(text: string, max = 600): string {
  return text.length > max ? text.slice(-max) : text;
}

function statusFor(ctx: ServerContext): GraviewFaceStatus {
  const graviewDir = resolveLayout(ctx.projectDir).graviewDir;
  const running = readRunningFace(graviewDir);
  const launch = launches.get(ctx.projectDir);
  if (running && launch && launch.facePid === undefined) launch.facePid = running.pid;
  return {
    face: running ? { url: running.url } : null,
    enabled: isFeatureEnabled(ctx.projectDir, GRAVIEW_FACE_FEATURE),
    starting: !running && !!launch && !launch.exited,
    error: running ? null : (lastErrors.get(ctx.projectDir) ?? null),
  };
}

/**
 * Start `ndx graview serve` for this project unless a face is running or
 * this server's launch still is. Returns the status after the attempt.
 */
export function startGraviewFace(ctx: ServerContext): GraviewFaceStatus {
  const before = statusFor(ctx);
  if (before.face || before.starting) return before;
  const ndx = resolveNdxBin(ctx);
  lastErrors.delete(ctx.projectDir);
  // `ndx graview serve` is a server: core gives it no timeout, and neither does this spawn.
  const child = spawnManaged(ndx.bin, [...ndx.args, "graview", "serve", ctx.projectDir], {
    cwd: ctx.projectDir,
    stdio: "pipe",
  });
  const launch: Launch = { child, exited: false };
  launches.set(ctx.projectDir, launch);
  void child.done.then((result) => {
    launch.exited = true;
    if (launches.get(ctx.projectDir) === launch) launches.delete(ctx.projectDir);
    if (result.exitCode !== 0) lastErrors.set(ctx.projectDir, tail((result.stderr || `ndx graview serve exited with code ${result.exitCode}`).trim()));
  });
  return statusFor(ctx);
}

/** With the flag on, start the product map as the dashboard comes up. */
export function startGraviewFaceAtBoot(ctx: ServerContext): void {
  if (!isFeatureEnabled(ctx.projectDir, GRAVIEW_FACE_FEATURE)) return;
  const status = startGraviewFace(ctx);
  if (status.face) console.log(`[graview] product map already running at ${status.face.url}`);
  else console.log("[graview] starting the product map (features.graview.productFace)");
}

/** Stop the faces this server started; a face someone else started is left alone. */
export async function shutdownGraviewFace(): Promise<void> {
  const pending = [...launches.values()];
  launches.clear();
  for (const launch of pending) {
    if (launch.exited) continue;
    launch.child.kill("SIGTERM");
    if (launch.facePid !== undefined) {
      try {
        process.kill(launch.facePid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  await Promise.race([Promise.all(pending.map((l) => l.child.done)), new Promise((r) => setTimeout(r, 2000))]);
}

/** Handle the product-map routes. Returns true if the request was handled. */
export async function handleGraviewRoute(req: IncomingMessage, res: ServerResponse, ctx: ServerContext): Promise<boolean> {
  const path = (req.url || "/").split("?")[0];
  if (path !== ROUTE) return false;
  const method = req.method || "GET";
  if (method === "GET") {
    jsonResponse(res, 200, statusFor(ctx));
    return true;
  }
  if (method === "POST") {
    if (!isFeatureEnabled(ctx.projectDir, GRAVIEW_FACE_FEATURE)) {
      // Not in ROUTE_FEATURE_GATES: that gates the whole path, and the GET answers with the flag off too.
      jsonResponse(res, 403, featureDisabledBody(GRAVIEW_FACE_FEATURE, ROUTE));
      return true;
    }
    jsonResponse(res, 202, startGraviewFace(ctx));
    return true;
  }
  errorResponse(res, 405, "Method not allowed");
  return true;
}
