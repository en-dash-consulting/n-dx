/**
 * Backfill commit attribution from git history.
 *
 * Walks git log looking for N-DX-Status trailers in commit messages.
 * For each completed task marked in git history, reads the commit hash,
 * author, email, and timestamp, then populates the PRD item's commits
 * array (idempotently).
 *
 * @module rex/cli/commands/backfill-commit-attribution
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { info, warn } from "../output.js";
import { resolveStore } from "../../store/index.js";
import type { PRDItem, CommitAttribution } from "../../schema/index.js";

const execAsync = promisify(execFile);

/**
 * Parse git log output to extract N-DX-Status trailers.
 *
 * Format: `git log --format=%B` produces commit subject + body with trailers.
 * The function looks for trailers like:
 *   N-DX-Status: <taskId> <oldStatus> → <newStatus>
 */
function parseNdxStatusTrailer(body: string): { taskId: string; oldStatus: string; newStatus: string } | null {
  const lines = body.split("\n");
  for (const line of lines) {
    const match = line.match(/^N-DX-Status:\s+(\S+)\s+(\S+)\s+→\s+(\S+)/);
    if (match) {
      return {
        taskId: match[1],
        oldStatus: match[2],
        newStatus: match[3],
      };
    }
  }
  return null;
}

/**
 * Extract commit metadata from lines formatted as hash, timestamp, author, email.
 */
function parseCommitLine(
  hash: string,
  timestamp: string,
  author: string,
  authorEmail: string,
): CommitAttribution {
  return {
    hash: hash.trim(),
    author: author.trim(),
    authorEmail: authorEmail.trim(),
    timestamp: timestamp.trim(),
  };
}

/**
 * Walk entire PRD tree and collect all items into a flat list.
 */
function flattenItems(items: PRDItem[]): PRDItem[] {
  const result: PRDItem[] = [];
  const visit = (list: PRDItem[]) => {
    for (const item of list) {
      result.push(item);
      if (item.children) visit(item.children);
    }
  };
  visit(items);
  return result;
}

/**
 * Execute git log and parse commits with N-DX-Status trailers.
 */
async function getCommitsWithNdxStatus(
  projectDir: string,
): Promise<
  Array<{
    hash: string;
    timestamp: string;
    author: string;
    authorEmail: string;
    taskId: string;
    oldStatus: string;
    newStatus: string;
  }>
> {
  try {
    // Use ASCII field separator to avoid ambiguity with newlines in commit bodies
    const FS = String.fromCharCode(0x1f); // Unit separator
    const RS = String.fromCharCode(0x1e); // Record separator

    const format = `%H${FS}%cI${FS}%an${FS}%ae${FS}%B${RS}`;
    const { stdout } = await execAsync("git", ["log", `--pretty=format:${format}`, "--reverse"], {
      cwd: projectDir,
    });

    const commits = [];
    const records = stdout.split(RS);

    for (const record of records) {
      if (!record.trim()) continue;

      const fields = record.split(FS);
      if (fields.length < 5) continue;

      const hash = fields[0].trim();
      const timestamp = fields[1].trim();
      const author = fields[2].trim();
      const authorEmail = fields[3].trim();
      const body = fields[4];

      // Parse N-DX-Status trailer from commit body
      const trailer = parseNdxStatusTrailer(body);
      if (trailer) {
        commits.push({
          hash,
          timestamp,
          author,
          authorEmail,
          taskId: trailer.taskId,
          oldStatus: trailer.oldStatus,
          newStatus: trailer.newStatus,
        });
      }
    }

    return commits;
  } catch (err) {
    // If git fails (e.g., no commits), return empty list
    if ((err as { code: string }).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Backfill commit attribution from git history into PRD items.
 */
export async function cmdBackfillCommitAttribution(
  dir: string,
  flags?: Record<string, string>,
): Promise<void> {
  const REX_DIR = ".rex";
  const rexDir = join(dir, REX_DIR);

  // Load PRD document
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  // Flatten items into a single list for lookup
  const allItems = flattenItems(doc.items);
  const itemById = new Map<string, PRDItem>();
  for (const item of allItems) {
    itemById.set(item.id, item);
  }

  // Scan git log for commits with N-DX-Status trailers
  let gitCommits: ReturnType<typeof getCommitsWithNdxStatus> extends Promise<infer R> ? R : never;
  try {
    gitCommits = await getCommitsWithNdxStatus(dir);
  } catch (err) {
    warn(`Warning: could not read git history: ${(err as Error).message}`);
    return;
  }

  if (gitCommits.length === 0) {
    info(`No commits with N-DX-Status trailers found.`);
    return;
  }

  // Process each commit and update PRD items
  const result = {
    itemsUpdated: 0,
    commitsAdded: 0,
    itemsSkipped: 0,
    itemsNotFound: 0,
  };

  for (const commit of gitCommits) {
    const item = itemById.get(commit.taskId);
    if (!item) {
      result.itemsNotFound++;
      info(`Skipped: task ID "${commit.taskId}" not found in PRD`);
      continue;
    }

    // Check if this commit is already recorded (idempotent)
    const existing = item.commits ?? [];
    if (existing.some((c) => c.hash === commit.hash)) {
      result.itemsSkipped++;
      continue;
    }

    // Create new attribution and append
    const attribution = parseCommitLine(
      commit.hash,
      commit.timestamp,
      commit.author,
      commit.authorEmail,
    );

    const updatedCommits = [...existing, attribution];
    item.commits = updatedCommits;
    result.commitsAdded++;

    // Track if we're updating this item for the first time
    if (existing.length === 0) {
      result.itemsUpdated++;
    }
  }

  // Save updated document
  if (result.commitsAdded > 0) {
    await store.saveDocument(doc);
  }

  // Report results
  const isNoOp = result.commitsAdded === 0;
  if (isNoOp) {
    info(`Already up to date — all commits recorded.`);
    return;
  }

  info(`Backfilled commit attribution from git history.`);
  const parts: string[] = [];
  if (result.itemsUpdated > 0) parts.push(`${result.itemsUpdated} item(s) updated`);
  if (result.commitsAdded > 0) parts.push(`${result.commitsAdded} commit(s) recorded`);
  if (result.itemsSkipped > 0) parts.push(`${result.itemsSkipped} duplicate(s) skipped`);
  if (result.itemsNotFound > 0) parts.push(`${result.itemsNotFound} missing task(s) skipped`);

  if (parts.length > 0) {
    info(`  ${parts.join(", ")}`);
  }
}
