/**
 * The hench run history the dashboard's two tuners read: the adaptive
 * workflow adjustments (`routes-adaptive.ts`) and the workflow optimization
 * suggestions (`routes-workflow.ts`).
 *
 * The record shape is declared here rather than imported, because web does
 * not depend on hench; it carries only the fields the tuners analyse.
 *
 * @module web/server/tuner-runs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { henchDirIn } from "./paths.js";

/** A hench run record, as far as the tuners read it. */
export interface RunData {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  turns: number;
  error?: string;
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  toolCalls: unknown[];
  model: string;
  retryAttempts?: number;
}

/**
 * Every readable run record in the project's hench runs directory, newest
 * first. A file that does not parse, or lacks an id or start time, is skipped;
 * a missing directory is no runs.
 */
export function loadRuns(projectDir: string): RunData[] {
  const runsDir = join(henchDirIn(projectDir), "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return [];
  }

  const runs: RunData[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = readFileSync(join(runsDir, file), "utf-8");
      const data = JSON.parse(raw) as RunData;
      if (data.id && data.startedAt) {
        runs.push(data);
      }
    } catch {
      // skip invalid files
    }
  }

  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
