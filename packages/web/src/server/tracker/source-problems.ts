/**
 * Why a tracker event source could not be read, kept so an operator can see it:
 * `<henchDir>/sidecar/tracker-source-problems.json`, beside the cursors, machine
 * local and ignored by git. Each tick rewrites the entry of every source whose
 * rule is on: a problem is recorded with the time it first read that way (an
 * unchanged problem keeps its time, so a steady failure writes nothing), and a
 * source that reads again (or whose rule is turned off) loses its entry. The
 * activity route answers them with the log.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSidecarDir } from "../sidecar/sidecar-dir.js";
import { worktreeSidecarDir } from "../sidecar/session-registry.js";
import type { TrackerEvent } from "./server-profiles.js";

/** One source that could not be read at the last tick. */
export interface SourceProblem {
  event: TrackerEvent;
  problem: string;
  /** ISO time of the tick that first saw this problem. */
  at: string;
}

const PROBLEMS_FILE = "tracker-source-problems.json";

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The problems recorded for `projectDir`, in event order of the file; an unreadable file reads as none. */
export function readSourceProblems(projectDir: string): SourceProblem[] {
  const path = join(worktreeSidecarDir(projectDir), PROBLEMS_FILE);
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
  const sources = isRecord(raw) && Array.isArray(raw.sources) ? raw.sources : [];
  return sources.flatMap((s) =>
    isRecord(s) && typeof s.event === "string" && typeof s.problem === "string" && typeof s.at === "string"
      ? [{ event: s.event as TrackerEvent, problem: s.problem, at: s.at }]
      : [],
  );
}

/** Save `problems` whole, written beside and renamed over. Nothing is written when nothing changes. */
export function writeSourceProblems(projectDir: string, problems: readonly SourceProblem[]): void {
  const prior = readSourceProblems(projectDir);
  if (JSON.stringify(prior) === JSON.stringify(problems)) return;
  const dir = worktreeSidecarDir(projectDir);
  ensureSidecarDir(dir);
  const path = join(dir, PROBLEMS_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, sources: problems }, null, 2) + "\n", "utf-8");
  renameSync(temp, path);
}
