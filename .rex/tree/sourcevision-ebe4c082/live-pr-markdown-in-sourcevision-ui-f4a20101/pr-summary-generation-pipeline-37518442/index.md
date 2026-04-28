---
id: "37518442-4193-401f-9d21-53c8b3c79107"
level: "task"
title: "PR Summary Generation Pipeline"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T05:31:15.074Z"
completedAt: "2026-02-21T05:31:15.074Z"
description: "Generate a reliable markdown PR summary from current branch changes against main, including clear base reference metadata."
---

## Subtask: Implement PR markdown generator for current branch vs main

**ID:** `a76d935c-debc-4594-acce-6d7e86c94de7`
**Status:** completed
**Priority:** critical

Create a generator that builds a structured markdown summary from git diff output so users can paste directly into pull requests without manual rewriting.

**Acceptance Criteria**

- Generates markdown from `main...HEAD` comparison when git data is available
- Includes sections for overview, changed files, and notable change summaries
- Output is plain markdown text with no HTML-only formatting dependencies
- Generator returns deterministic section order for identical git input

---

## Subtask: Include explicit base branch and commit metadata in generated summary

**ID:** `e64a0730-d99f-4e52-8019-b5ccb29454fd`
**Status:** completed
**Priority:** high

Ensure users can verify exactly what baseline the summary compares against by embedding branch and commit identifiers in the markdown header.

**Acceptance Criteria**

- Markdown includes base branch name and base commit SHA
- Markdown includes current HEAD commit SHA
- When base resolution fails, markdown displays a fallback marker instead of empty values
- Metadata appears at the top of the summary in a dedicated section

---

## Subtask: Incorporate dirty and untracked file state into PR summary

**ID:** `c7e9ab41-9002-41e7-813a-5fb3e4f72147`
**Status:** completed
**Priority:** high

Expose local-only working tree changes so the summary reflects what users actually see before committing, reducing mismatch between UI and repository state.

**Acceptance Criteria**

- Summary includes a section listing modified but unstaged files
- Summary includes a section listing untracked files
- Dirty/untracked sections are omitted or marked none when not present
- Working tree state is refreshed from current git status at generation time

---
