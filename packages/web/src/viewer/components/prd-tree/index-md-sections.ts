/**
 * Preact components for rendering index.md schema sections in detail panel.
 *
 * Renders: Progress table (sortable), Commits, Changes, Info, Summary, Subtasks
 *
 * @module web/viewer/components/prd-tree/index-md-sections
 */

import { h, Fragment } from "preact";
import { useState, useMemo } from "preact/hooks";
import type {
  IndexMdSections,
  ProgressRow,
  CommitRef,
  ChangeEntry,
  InfoField,
  SubtaskEntry,
} from "../../utils/index-md-parser.js";

type SortColumn = "title" | "level" | "status" | "lastUpdated" | null;
type SortDirection = "asc" | "desc";

/**
 * Sortable Progress Table
 */
export function ProgressTable({ rows }: { rows: ProgressRow[] }) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("lastUpdated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;

    const sorted = [...rows].sort((a, b) => {
      let aVal: string, bVal: string;

      switch (sortColumn) {
        case "title":
          aVal = a.title;
          bVal = b.title;
          break;
        case "level":
          aVal = a.level;
          bVal = b.level;
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "lastUpdated":
          aVal = a.lastUpdated;
          bVal = b.lastUpdated;
          break;
        default:
          return 0;
      }

      const cmp = aVal.localeCompare(bVal);
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [rows, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  return h(
    "div",
    { class: "detail-progress-section" },
    h(
      "table",
      { class: "detail-progress-table" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h(
            "th",
            {
              class: `sortable${sortColumn === "title" ? " active" : ""}`,
              onClick: () => handleSort("title"),
              title: "Click to sort by title",
            },
            "Child",
            sortColumn === "title" ? (sortDirection === "asc" ? " ▲" : " ▼") : "",
          ),
          h(
            "th",
            {
              class: `sortable${sortColumn === "level" ? " active" : ""}`,
              onClick: () => handleSort("level"),
              title: "Click to sort by level",
            },
            "Level",
            sortColumn === "level" ? (sortDirection === "asc" ? " ▲" : " ▼") : "",
          ),
          h(
            "th",
            {
              class: `sortable${sortColumn === "status" ? " active" : ""}`,
              onClick: () => handleSort("status"),
              title: "Click to sort by status",
            },
            "Status",
            sortColumn === "status" ? (sortDirection === "asc" ? " ▲" : " ▼") : "",
          ),
          h(
            "th",
            {
              class: `sortable${sortColumn === "lastUpdated" ? " active" : ""}`,
              onClick: () => handleSort("lastUpdated"),
              title: "Click to sort by last updated",
            },
            "Last Updated",
            sortColumn === "lastUpdated" ? (sortDirection === "asc" ? " ▲" : " ▼") : "",
          ),
        ),
      ),
      h(
        "tbody",
        null,
        sortedRows.map((row) =>
          h(
            "tr",
            { key: `${row.title}-${row.lastUpdated}` },
            h("td", null, row.title),
            h("td", null, h("span", { class: `prd-level-badge prd-level-${row.level}` }, row.level)),
            h("td", null, h("span", { class: `prd-status-badge prd-status-${row.status}` }, row.status)),
            h("td", null, row.lastUpdated),
          ),
        ),
      ),
    ),
  );
}

/**
 * Commits Table with author, hash (linked), and timestamp
 */
export function CommitsList({ commits, gitRemoteUrl }: { commits: CommitRef[]; gitRemoteUrl?: string }) {
  if (commits.length === 0) {
    return h(
      "div",
      { class: "detail-commits-section detail-commits-empty" },
      h("p", { class: "detail-commits-empty-state" }, "No commits recorded"),
    );
  }

  return h(
    "div",
    { class: "detail-commits-section" },
    h(
      "table",
      { class: "detail-commits-table" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, "Author"),
          h("th", null, "Hash"),
          h("th", null, "Message"),
          h("th", null, "Timestamp"),
        ),
      ),
      h(
        "tbody",
        null,
        commits.map((commit) => {
          const shortHash = commit.hash.slice(0, 7);
          let hashCell;

          if (gitRemoteUrl) {
            // Generate GitHub/GitLab link
            const repoUrl = gitRemoteUrl.replace(/\.git$/, "");
            const commitUrl = `${repoUrl}/commit/${commit.hash}`;
            hashCell = h(
              "a",
              {
                href: commitUrl,
                target: "_blank",
                rel: "noopener noreferrer",
                class: "commit-hash-link",
                title: commit.hash,
              },
              shortHash,
            );
          } else {
            // Plain text with full hash on hover
            hashCell = h(
              "code",
              {
                class: "commit-hash",
                title: commit.hash,
              },
              shortHash,
            );
          }

          return h(
            "tr",
            { key: commit.hash, class: "detail-commit-row" },
            h("td", { class: "commit-author" }, commit.author),
            h("td", { class: "commit-hash-cell" }, hashCell),
            h("td", { class: "commit-message" }, commit.message || "—"),
            h("td", { class: "commit-timestamp" }, commit.timestamp),
          );
        }),
      ),
    ),
  );
}

/**
 * Changes List
 */
export function ChangesList({ changes }: { changes: ChangeEntry[] }) {
  return h(
    "div",
    { class: "detail-changes-section" },
    h(
      "ul",
      { class: "detail-changes-list" },
      changes.map((change, idx) =>
        h(
          "li",
          { key: idx, class: "detail-change-item" },
          h("strong", null, `${change.label}:`),
          ` ${change.description} `,
          h("span", { class: "change-timestamp" }, `(${change.timestamp})`),
        ),
      ),
    ),
  );
}

/**
 * Info Section (metadata fields)
 */
export function InfoSection({ fields }: { fields: InfoField[] }) {
  return h(
    "div",
    { class: "detail-info-section" },
    h(
      "ul",
      { class: "detail-info-list" },
      fields.map((field) =>
        h(
          "li",
          { key: field.label, class: "detail-info-item" },
          h("strong", null, `${field.label}:`),
          ` ${field.value}`,
        ),
      ),
    ),
  );
}

/**
 * Summary Section (rendered prose)
 */
export function SummarySection({ markdown }: { markdown: string }) {
  // Simple markdown to HTML conversion for summary
  // In a real implementation, you'd use the existing renderMarkdownPreview pattern
  const html = markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (line.startsWith("* ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (line.trim()) return `<p>${escapeHtml(line)}</p>`;
      return "";
    })
    .join("");

  return h("div", {
    class: "detail-summary-section",
    dangerouslySetInnerHTML: { __html: html },
  });
}

/**
 * Subtasks display
 */
export function SubtasksList({ subtasks }: { subtasks: SubtaskEntry[] }) {
  return h(
    "div",
    { class: "detail-subtasks-section" },
    h("div", { class: "task-section-label" }, `Subtasks (${subtasks.length})`),
    h(
      "div",
      { class: "detail-subtasks-list" },
      subtasks.map((subtask) =>
        h(
          "div",
          { key: subtask.id, class: "detail-subtask-item" },
          h("div", { class: "subtask-header" },
            h("span", { class: "subtask-id" }, subtask.id.slice(0, 8)),
            h("span", { class: `prd-status-badge prd-status-${subtask.status}` }, subtask.status),
            subtask.priority ? h("span", { class: `prd-priority-badge prd-priority-${subtask.priority}` }, subtask.priority) : null,
          ),
          h("div", { class: "subtask-title" }, subtask.title),
          subtask.description ? h("div", { class: "subtask-description" }, subtask.description) : null,
          subtask.acceptanceCriteria && subtask.acceptanceCriteria.length > 0
            ? h(
                "ul",
                { class: "subtask-criteria" },
                subtask.acceptanceCriteria.map((criterion, idx) =>
                  h("li", { key: idx }, criterion),
                ),
              )
            : null,
        ),
      ),
    ),
  );
}

/**
 * Main index.md sections container
 */
export function IndexMdSectionsPanel({ sections, gitRemoteUrl }: { sections: IndexMdSections; gitRemoteUrl?: string }) {
  if (!sections || Object.keys(sections).length === 0) {
    return null;
  }

  return h(
    Fragment,
    null,
    // Progress section
    sections.progress && sections.progress.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h("div", { class: "task-section-label" }, "Progress"),
          h(ProgressTable, { rows: sections.progress }),
        )
      : null,

    // Commits section
    sections.commits && sections.commits.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h("div", { class: "task-section-label" }, "Commits"),
          h(CommitsList, { commits: sections.commits, gitRemoteUrl }),
        )
      : null,

    // Changes section
    sections.changes && sections.changes.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h("div", { class: "task-section-label" }, "Changes"),
          h(ChangesList, { changes: sections.changes }),
        )
      : null,

    // Info section
    sections.info && sections.info.length > 0
      ? h(
          "div",
          { class: "task-section" },
          h("div", { class: "task-section-label" }, "Extended Info"),
          h(InfoSection, { fields: sections.info }),
        )
      : null,

    // Subtasks section
    sections.subtasks && sections.subtasks.length > 0
      ? h(SubtasksList, { subtasks: sections.subtasks })
      : null,

    // Fallback: raw markdown if parsing failed
    sections.rawMarkdown && !sections.progress && !sections.commits
      ? h(
          "div",
          { class: "task-section" },
          h("div", { class: "task-section-label" }, "Schema Content (Legacy)"),
          h("pre", { class: "detail-raw-markdown" }, sections.rawMarkdown),
        )
      : null,
  );
}

/**
 * Simple HTML escape utility
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
