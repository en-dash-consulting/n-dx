/**
 * Persistent run log — writes captured output lines to a timestamped file
 * under .run-logs/ at the project root.
 *
 * The directory is created automatically on first use. The project's
 * .gitignore is updated to exclude .run-logs/ if the entry is missing.
 *
 * Log file naming convention: {ISO-timestamp-safe}-{runId}.log
 * Example: 2026-04-08T23-21-17-abc123ef-….log
 *
 * @module
 */

import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const LOG_DIR_NAME = ".run-logs";
const GITIGNORE_ENTRY = ".run-logs/";

/**
 * Persist captured run output to a timestamped log file under .run-logs/
 * at the project root. Creates the directory automatically. Adds
 * .run-logs/ to the project .gitignore if the entry is missing.
 *
 * @param projectDir  Absolute path to the project root.
 * @param runId       The run's unique identifier (used in the filename).
 * @param startedAt   ISO 8601 timestamp of run start (used in the filename).
 * @param lines       Plain-text output lines in emission order.
 * @returns           Absolute path of the written log file.
 */
export async function persistRunLog(
  projectDir: string,
  runId: string,
  startedAt: string,
  lines: readonly string[],
): Promise<string> {
  const logDir = join(projectDir, LOG_DIR_NAME);
  await mkdir(logDir, { recursive: true });

  // Best-effort gitignore update — never throws.
  await ensureGitignored(projectDir);

  // Convert ISO timestamp to filesystem-safe form: colons → hyphens,
  // fractional seconds and timezone suffix stripped.
  const safeTimestamp = startedAt
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "")
    .replace(/Z$/, "");

  const filename = `${safeTimestamp}-${runId}.log`;
  const logPath = join(logDir, filename);

  const content = lines.length > 0 ? lines.join("\n") + "\n" : "";
  await writeFile(logPath, content, "utf-8");

  return logPath;
}

/**
 * Append `.run-logs/` to the project .gitignore if the entry is not
 * already present. Creates .gitignore if it does not exist.
 * Errors are swallowed — a missing .gitignore update must not crash a run.
 */
async function ensureGitignored(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch {
    // File does not exist — will create it below with just the entry.
  }

  const normalised = GITIGNORE_ENTRY.replace(/\/$/, ""); // ".run-logs"
  const alreadyPresent = existing
    .split("\n")
    .some((l) => l.trim() === GITIGNORE_ENTRY || l.trim() === normalised);

  if (alreadyPresent) return;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  try {
    await writeFile(gitignorePath, existing + separator + GITIGNORE_ENTRY + "\n", "utf-8");
  } catch {
    // Best-effort — never propagate gitignore write failures.
  }
}
