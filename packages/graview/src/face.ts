/**
 * Where a running product face is. The face (`@n-dx/graview-face`'s
 * `bin/serve.js`) writes `face.json` beside the projection once it listens
 * and removes it when it stops; a record whose process is gone is stale.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FACE_FILENAME = "face.json";

export interface RunningFace {
  url: string;
  pid: number;
  startedAt?: string;
}

/** The face serving this graview dir, or undefined when none is running. */
export function runningFace(graviewDir: string, isAlive: (pid: number) => boolean = processAlive): RunningFace | undefined {
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(join(graviewDir, FACE_FILENAME), "utf-8"));
  } catch {
    return undefined;
  }
  const { url, pid, startedAt } = (record ?? {}) as Record<string, unknown>;
  if (typeof url !== "string" || !/^https?:\/\//.test(url) || typeof pid !== "number" || !isAlive(pid)) return undefined;
  return { url, pid, ...(typeof startedAt === "string" ? { startedAt } : {}) };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, under another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
