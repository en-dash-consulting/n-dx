/**
 * Parser for index.md schema sections.
 *
 * Extracts structured sections from the generated index.md markdown files.
 * Handles: Summary, Progress table, Commits, Changes, Info, and Subtasks.
 *
 * @module web/viewer/utils/index-md-parser
 */

export interface ProgressRow {
  title: string;
  level: string;
  status: string;
  lastUpdated: string;
}

export interface CommitRef {
  hash: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  message?: string;
}

export interface ChangeEntry {
  label: string;
  description: string;
  timestamp: string;
}

export interface InfoField {
  label: string;
  value: string;
}

export interface SubtaskEntry {
  id: string;
  title: string;
  status: string;
  priority?: string;
  description?: string;
  acceptanceCriteria?: string[];
}

export interface IndexMdSections {
  summary?: string;
  progress?: ProgressRow[];
  commits?: CommitRef[];
  changes?: ChangeEntry[];
  info?: InfoField[];
  subtasks?: SubtaskEntry[];
  rawMarkdown?: string; // Fallback for unparseable content
}

/**
 * Extract sections from index.md markdown content.
 * Returns structured data for each recognized section type.
 * Gracefully handles missing or partially-generated files.
 */
export function parseIndexMd(markdown: string): IndexMdSections {
  const sections: IndexMdSections = {};

  try {
    // Extract Summary section
    const summaryMatch = markdown.match(/## Summary\s*\n([\s\S]*?)(?=\n## |\n# |\s*$)/);
    if (summaryMatch) {
      sections.summary = summaryMatch[1].trim();
    }

    // Extract Progress table
    const progressMatch = markdown.match(/## Progress\s*\n([\s\S]*?)(?=\n## |\n# |\s*$)/);
    if (progressMatch) {
      sections.progress = parseProgressTable(progressMatch[1]);
    }

    // Extract Commits section
    const commitsMatch = markdown.match(/## Commits\s*\n([\s\S]*?)(?=\n## |\n# |\s*$)/);
    if (commitsMatch) {
      const parsed = parseCommitsList(commitsMatch[1]);
      if (parsed.length > 0) {
        sections.commits = parsed;
      }
    }

    // Extract Changes section
    const changesMatch = markdown.match(/## Changes\s*\n([\s\S]*?)(?=\n## |\n# |\s*$)/);
    if (changesMatch) {
      const parsed = parseChangesList(changesMatch[1]);
      if (parsed.length > 0) {
        sections.changes = parsed;
      }
    }

    // Extract Info section
    const infoMatch = markdown.match(/## Info\s*\n([\s\S]*?)(?=\n## |\n# |\s*$)/);
    if (infoMatch) {
      const parsed = parseInfoSection(infoMatch[1]);
      if (parsed.length > 0) {
        sections.info = parsed;
      }
    }

    // Extract Subtasks sections
    const subtasksMatches = markdown.matchAll(/## Subtask: (.+?)\n([\s\S]*?)(?=\n## Subtask:|$)/g);
    const subtasks: SubtaskEntry[] = [];
    for (const match of subtasksMatches) {
      const parsed = parseSubtaskBlock(match[1], match[2]);
      if (parsed) subtasks.push(parsed);
    }
    if (subtasks.length > 0) {
      sections.subtasks = subtasks;
    }
  } catch {
    // Graceful fallback: include raw markdown if parsing throws
    sections.rawMarkdown = markdown;
    return sections;
  }

  // Fallback for non-empty markdown with no recognized sections
  if (Object.keys(sections).length === 0 && markdown.trim().length > 0) {
    sections.rawMarkdown = markdown;
  }

  return sections;
}

/**
 * Parse the Progress table from markdown.
 * Expected format: Markdown table with columns: Child, Level, Status, Last Updated
 */
function parseProgressTable(content: string): ProgressRow[] {
  const rows: ProgressRow[] = [];
  const lines = content.split("\n");

  // Skip header rows (markdown table header and separator)
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("---") && lines[i].includes("|")) {
      dataStart = i + 1;
      break;
    }
  }

  // Parse data rows
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.startsWith("|")) break;

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c);

    if (cells.length >= 4) {
      rows.push({
        title: cells[0],
        level: cells[1],
        status: cells[2],
        lastUpdated: cells[3],
      });
    }
  }

  return rows;
}

/**
 * Parse the Commits table from markdown.
 * Expected format: Markdown table with columns: Author, Hash, Message, Timestamp
 * Also handles legacy bullet-list format for backward compatibility.
 */
function parseCommitsList(content: string): CommitRef[] {
  const commits: CommitRef[] = [];
  const lines = content.split("\n");

  // Try to parse as table first (new format)
  let dataStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("---") && lines[i].includes("|")) {
      dataStart = i + 1;
      break;
    }
  }

  if (dataStart > 0) {
    // Parse table format
    for (let i = dataStart; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || !line.startsWith("|")) break;

      // Split by pipe and trim each cell
      const parts = line.split("|");
      // Remove leading/trailing empty elements from pipe delimiters
      const cells = parts.slice(1, -1).map((c) => c.trim());

      if (cells.length >= 4) {
        // Cells: [author, hash, message, timestamp]
        let hash = cells[1].replace(/`/g, "").trim();

        commits.push({
          hash: hash,
          author: cells[0] || "",
          authorEmail: "", // Not available in table format, would need separate field
          timestamp: cells[3] || "",
          message: cells[2] || "",
        });
      }
    }
  } else {
    // Fallback: parse legacy bullet-list format
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("-")) continue;

      // Legacy format: - `hash` — message (date)
      const match = trimmed.match(/`([a-f0-9]+)`\s*—\s*(.+?)\s*\(([^)]+)\)/);
      if (match) {
        commits.push({
          hash: match[1],
          author: "unknown",
          authorEmail: "",
          timestamp: match[3].trim(),
          message: match[2].trim(),
        });
      }
    }
  }

  return commits;
}

/**
 * Parse the Changes section from markdown.
 * Expected format: Bullet list with **Label:** description (timestamp)
 */
function parseChangesList(content: string): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("-")) continue;

    // Format: - **Label:** description (timestamp)
    // Accept both `**Label:**` (generator format, colon inside) and
    // `**Label**:` (colon outside) for resilience.
    const match = trimmed.match(/\*\*([^*]+?):?\*\*:?\s*(.+?)\s*\(([^)]+)\)/);
    if (match) {
      changes.push({
        label: match[1].trim().replace(/:$/, ""),
        description: match[2].trim(),
        timestamp: match[3].trim(),
      });
    }
  }

  return changes;
}

/**
 * Parse the Info section from markdown.
 * Expected format: Bullet list with **Label:** value
 */
function parseInfoSection(content: string): InfoField[] {
  const fields: InfoField[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("-")) continue;

    // Format: - **Label:** value
    // Accept both `**Label:**` (generator format, colon inside) and
    // `**Label**:` (colon outside) for resilience.
    const match = trimmed.match(/\*\*([^*]+?):?\*\*:?\s*(.+)/);
    if (match) {
      fields.push({
        label: match[1].trim().replace(/:$/, ""),
        value: match[2].trim(),
      });
    }
  }

  return fields;
}

/**
 * Parse a single Subtask block.
 */
function parseSubtaskBlock(title: string, content: string): SubtaskEntry | null {
  const lines = content.split("\n");
  const entry: SubtaskEntry = {
    id: "",
    title: title.trim(),
    status: "pending",
  };

  // Parse metadata lines
  for (const line of lines) {
    const trimmed = line.trim();

    // **ID:** uuid
    if (trimmed.startsWith("**ID:**")) {
      entry.id = trimmed.replace(/\*\*ID:\*\*\s*/, "").replace(/`/g, "").trim();
    }
    // **Status:** value
    else if (trimmed.startsWith("**Status:**")) {
      entry.status = trimmed.replace(/\*\*Status:\*\*\s*/, "").trim();
    }
    // **Priority:** value
    else if (trimmed.startsWith("**Priority:**")) {
      entry.priority = trimmed.replace(/\*\*Priority:\*\*\s*/, "").trim();
    }
  }

  // Extract description (prose between metadata and **Acceptance Criteria**)
  const descMatch = content.match(/\n\n([\s\S]+?)(?=\n\n\*\*Acceptance Criteria|$)/);
  if (descMatch) {
    entry.description = descMatch[1].trim();
  }

  // Extract acceptance criteria
  const acMatch = content.match(/\*\*Acceptance Criteria\*\*\n([\s\S]+?)(?:\n\n|$)/);
  if (acMatch) {
    const acText = acMatch[1];
    entry.acceptanceCriteria = acText
      .split("\n")
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter((line) => line);
  }

  return entry;
}
