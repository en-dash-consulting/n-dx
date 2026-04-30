/**
 * Generates folder-level index.md summaries for PRD items.
 *
 * Each folder's index.md provides a human-readable aggregation of:
 * - Item metadata (title, status, priority)
 * - Progress table (for containers with children)
 * - Commits list (for completed/in-progress items)
 * - Changes log (recent mutations)
 * - Info section (metadata)
 * - Subtask sections (for tasks)
 *
 * The index.md file is deterministic — same input tree always produces
 * identical output. Timestamps in commits/changes are from execution log
 * (not current time), ensuring stable regeneration.
 *
 * @module rex/store/folder-tree-index-generator
 */

import type { PRDItem, LogEntry } from "../schema/index.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate folder-level index.md content for an item.
 *
 * @param item The PRD item whose index.md is being generated
 * @param children Direct child items (for Progress table)
 * @param recentLog Recent log entries for Changes section
 * @returns Markdown content for index.md
 */
export function generateIndexMd(
  item: PRDItem,
  children: PRDItem[] = [],
  recentLog: LogEntry[] = [],
): string {
  const lines: string[] = [];

  // 1. Frontmatter
  lines.push("---");
  emitFrontmatter(lines, item);
  lines.push("---");
  lines.push("");

  // 2. Item Display Heading
  lines.push(renderItemDisplay(item));
  lines.push("");

  // 3. Summary Section (preserved on regeneration)
  lines.push("## Summary");
  lines.push("");
  if (item.description) {
    lines.push(item.description);
  } else {
    lines.push("No summary provided.");
  }
  lines.push("");

  // 4. Progress Section (for containers with children)
  if ((item.level === "epic" || item.level === "feature") && children.length > 0) {
    lines.push("## Progress");
    lines.push("");
    lines.push("| Child | Level | Status | Last Updated |");
    lines.push("|-------|-------|--------|--------------|");
    for (const child of children) {
      const lastUpdated = getLastUpdatedDate(child);
      lines.push(`| ${child.title} | ${child.level} | ${child.status} | ${lastUpdated} |`);
    }
    lines.push("");
  }

  // 5. Commits Section (for completed or in-progress items)
  if (
    item.status === "completed" ||
    item.status === "in_progress" ||
    item.status === "failing"
  ) {
    const commits = renderCommitsFromItem(item);
    if (commits.length > 0) {
      lines.push("## Commits");
      lines.push("");
      lines.push("| Author | Hash | Message | Timestamp |");
      lines.push("|--------|------|---------|-----------|");
      for (const commit of commits) {
        const shortHash = commit.hash.slice(0, 7);
        const fullHash = commit.hash;
        const author = commit.author || "unknown";
        const message = (commit.message || "").replace(/\|/g, "\\|");
        const timestamp = commit.timestamp || "";
        lines.push(`| ${author} | \`${shortHash}\` | ${message} | ${timestamp} |`);
      }
      lines.push("");
    }
  }

  // 6. Changes Section (if recent mutations exist)
  const changes = extractChanges(recentLog, item.id);
  if (changes.length > 0) {
    lines.push("## Changes");
    lines.push("");
    for (const change of changes) {
      lines.push(`- **${change.label}:** ${change.detail} (${change.timestamp})`);
    }
    lines.push("");
  }

  // 7. Info Section
  lines.push("## Info");
  lines.push("");
  lines.push(`- **Status:** ${item.status}`);
  if (item.priority) {
    lines.push(`- **Priority:** ${item.priority}`);
  }
  if (item.tags && item.tags.length > 0) {
    lines.push(`- **Tags:** ${item.tags.join(", ")}`);
  }
  lines.push(`- **Level:** ${item.level}`);
  if (item.startedAt) {
    lines.push(`- **Started:** ${item.startedAt}`);
  }
  if (item.completedAt) {
    lines.push(`- **Completed:** ${item.completedAt}`);
  } else if (item.endedAt) {
    lines.push(`- **Ended:** ${item.endedAt}`);
  }
  const duration = computeDuration(item.startedAt, item.completedAt || item.endedAt);
  if (duration) {
    lines.push(`- **Duration:** ${duration}`);
  }
  lines.push("");

  // 8. Subtask Sections (for tasks)
  if (item.level === "task" && item.children && item.children.length > 0) {
    const subtasks = item.children.filter(c => c.level === "subtask");
    for (const [idx, subtask] of subtasks.entries()) {
      lines.push("## Subtask: " + subtask.title);
      lines.push("");
      lines.push(`**ID:** \`${subtask.id}\``);
      lines.push(`**Status:** ${subtask.status}`);
      if (subtask.priority) {
        lines.push(`**Priority:** ${subtask.priority}`);
      }
      lines.push("");
      if (subtask.description) {
        lines.push(subtask.description);
        lines.push("");
      }
      if (subtask.acceptanceCriteria && subtask.acceptanceCriteria.length > 0) {
        lines.push("**Acceptance Criteria**");
        lines.push("");
        for (const criterion of subtask.acceptanceCriteria) {
          lines.push(`- ${criterion}`);
        }
        lines.push("");
      }
      // Add horizontal rule between subtasks, but not after the last one
      if (idx < subtasks.length - 1) {
        lines.push("---");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderItemDisplay(item: PRDItem): string {
  const title = `# ${item.title}`;
  const indicator = priorityIndicator(item.priority);
  const badge = `[${item.status}]`;
  return `${title}\n\n${indicator} ${badge}`.trim();
}

function priorityIndicator(priority?: string): string {
  switch (priority) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "⚪";
    default:
      return "";
  }
}

function emitFrontmatter(lines: string[], item: PRDItem): void {
  const ORDERED_FIELDS: ReadonlyArray<string> = [
    "id",
    "level",
    "title",
    "status",
    "priority",
    "tags",
    "blockedBy",
    "source",
    "startedAt",
    "completedAt",
    "endedAt",
    "resolutionType",
    "resolutionDetail",
    "failureReason",
    "acceptanceCriteria",
    "loe",
    "description",
  ];

  const STORAGE_FIELDS = new Set([
    "children",
    "branch",
    "sourceFile",
    "requirements",
    "activeIntervals",
    "mergedProposals",
    "tokenUsage",
    "duration",
    "loeRationale",
    "loeConfidence",
  ]);

  const emitted = new Set<string>();

  for (const key of ORDERED_FIELDS) {
    const value = (item as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    emitYamlField(lines, key, value);
    emitted.add(key);
  }

  // Emit unknown extra fields alphabetically
  const extraKeys = Object.keys(item)
    .filter(k => !emitted.has(k) && !STORAGE_FIELDS.has(k))
    .sort();
  for (const key of extraKeys) {
    const value = (item as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    emitYamlField(lines, key, value);
  }
}

function emitYamlField(lines: string[], key: string, value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${key}: []`);
    } else {
      lines.push(`${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          // Object items emit as inline JSON (valid YAML flow mapping).
          lines.push(`  - ${JSON.stringify(item)}`);
        } else {
          lines.push(`  - ${JSON.stringify(String(item))}`);
        }
      }
    }
  } else if (value !== null && typeof value === "object") {
    // Plain objects emit as inline JSON (valid YAML flow mapping).
    lines.push(`${key}: ${JSON.stringify(value)}`);
  } else {
    // Quote all scalar values consistently with folder-tree-serializer.ts
    lines.push(`${key}: ${JSON.stringify(String(value))}`);
  }
}

function getLastUpdatedDate(item: PRDItem): string {
  const date =
    item.completedAt ||
    item.endedAt ||
    item.startedAt ||
    new Date(0).toISOString();
  // Extract just the date part (YYYY-MM-DD)
  return date.split("T")[0];
}

interface CommitInfo {
  hash: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  message?: string;
}

function renderCommitsFromItem(item: PRDItem): CommitInfo[] {
  if (!item.commits || item.commits.length === 0) {
    return [];
  }
  // Convert CommitAttribution array directly to CommitInfo
  // Commits are stored in reverse chronological order (newest first) in the item
  return item.commits.map(commit => ({
    hash: commit.hash,
    author: commit.author,
    authorEmail: commit.authorEmail,
    timestamp: commit.timestamp,
    message: commit.message,
  }));
}

function extractCommits(_log: LogEntry[], _itemId: string): CommitInfo[] {
  // TODO: Parse execution log and git trailers to find commits for this item
  // For now, return empty list (placeholder for future implementation)
  return [];
}

interface ChangeInfo {
  label: string;
  detail: string;
  timestamp: string;
}

function extractChanges(log: LogEntry[], itemId: string): ChangeInfo[] {
  const changes: ChangeInfo[] = [];
  const relevant = log
    .filter(entry => entry.itemId === itemId)
    .reverse() // Most recent first
    .slice(0, 10); // Limit to 10 most recent

  for (const entry of relevant) {
    const label = formatEventLabel(entry.event);
    const detail = entry.detail || entry.event;
    const timestamp = entry.timestamp;
    changes.push({ label, detail, timestamp });
  }

  return changes;
}

function formatEventLabel(event: string): string {
  const labels: Record<string, string> = {
    status_changed: "Status changed",
    status_updated: "Status updated",
    task_completed: "Task completed",
    task_failed: "Task failed",
    execution_logged: "Execution logged",
  };
  return labels[event] || event;
}

function computeDuration(
  startedAt: string | undefined,
  endedAt: string | undefined,
): string | null {
  if (!startedAt || !endedAt) return null;

  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  const diffMs = end - start;

  if (diffMs < 0) return null;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    if (remainingHours === 0 && remainingMinutes === 0) {
      return `${days}d`;
    }
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  if (seconds < 60) {
    return "< 1m";
  }

  return null;
}
