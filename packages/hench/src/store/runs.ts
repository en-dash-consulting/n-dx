import { join } from "node:path";
import {readFile, writeFile, readdir, mkdir} from "node:fs/promises";import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { normalizeRunTokens, validateRunRecord } from "../schema/index.js";
import { redactDeep, toCanonicalJSON } from "../prd/llm-gateway.js";
import type { RunRecord } from "../schema/index.js";

const gunzipAsync = promisify(gunzip);

/**
 * Read a run file that may be either plain JSON or gzip-compressed.
 *
 * @param filePath Absolute path to a `.json` or `.json.gz` file.
 * @returns Parsed JSON data.
 */
async function readRunJSON(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath);
  if (filePath.endsWith(".gz")) {
    const decompressed = await gunzipAsync(raw);
    return JSON.parse(decompressed.toString("utf-8"));
  }
  return JSON.parse(raw.toString("utf-8"));
}

export async function saveRun(
  henchDir: string,
  run: RunRecord,
): Promise<void> {
  const runsDir = join(henchDir, "runs");
  await mkdir(runsDir, { recursive: true, mode: 0o700 });
  // Always stamp the normalized token tuple so that failed/aborted runs
  // are still joinable back to their PRD item at rollup time. Mutate the
  // caller's record so in-memory readers see the same value that was
  // written to disk.
  run.tokens = normalizeRunTokens(run.tokenUsage, run.turnTokenUsage);
  // What reaches disk is scrubbed of credential-shaped text (tool output that
  // echoed a .env, a bearer header in a failing curl, a connection string in a
  // stack trace). The in-memory record the agent is still working from is
  // left as it is; every later save re-applies the same idempotent pass.
  // Owner-only on creation; a later save leaves the mode alone.
  await writeFile(join(runsDir, `${run.id}.json`), toCanonicalJSON(redactDeep(run)), { encoding: "utf-8", mode: 0o600 });
}

export async function loadRun(
  henchDir: string,
  id: string,
): Promise<RunRecord> {
  const runsDir = join(henchDir, "runs");
  const jsonPath = join(runsDir, `${id}.json`);
  const gzPath = join(runsDir, `${id}.json.gz`);

  // Try uncompressed first, fall back to compressed
  let data: unknown;
  try {
    data = await readRunJSON(jsonPath);
  } catch {
    // Try compressed variant
    data = await readRunJSON(gzPath);
  }

  const result = validateRunRecord(data);
  if (!result.ok) {
    throw new Error(`Invalid run record ${id}: ${result.errors.message}`);
  }
  return result.data as RunRecord;
}

export async function listRuns(
  henchDir: string,
  limit?: number,
): Promise<RunRecord[]> {
  const runsDir = join(henchDir, "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }

  // Collect unique run IDs from both .json and .json.gz files
  const runIds = new Set<string>();
  for (const f of files) {
    if (f.endsWith(".json.gz") && !f.startsWith(".")) {
      runIds.add(f.replace(/\.json\.gz$/, ""));
    } else if (f.endsWith(".json") && !f.startsWith(".")) {
      runIds.add(f.replace(/\.json$/, ""));
    }
  }

  const sortedIds = [...runIds].sort().reverse();
  const toLoad = limit ? sortedIds.slice(0, limit) : sortedIds;

  const runs: RunRecord[] = [];
  for (const id of toLoad) {
    try {
      const run = await loadRun(henchDir, id);
      runs.push(run);
    } catch {
      // Skip invalid run files
    }
  }

  // Sort by startedAt descending
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return runs;
}

/**
 * Load the named runs, skipping any that are missing or invalid. For callers
 * that already narrowed the ledger (the per-day spend cap reads only files
 * written today) and should not pay for parsing the rest of it.
 */
export async function listRunsByIds(
  henchDir: string,
  ids: ReadonlyArray<string>,
): Promise<RunRecord[]> {
  const runs: RunRecord[] = [];
  for (const id of ids) {
    try {
      runs.push(await loadRun(henchDir, id));
    } catch {
      // Skip invalid or vanished run files
    }
  }
  return runs;
}
