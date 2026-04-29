---
id: "4ade01ce-d446-444b-8130-9bcca7e39ded"
level: "task"
title: "Interactive help navigation and discovery"
status: "completed"
source: "smart-add"
startedAt: "2026-02-17T23:24:13.741Z"
completedAt: "2026-02-17T23:24:13.741Z"
acceptanceCriteria: []
description: "Implement enhanced navigation, search, and suggestion capabilities to help users discover and understand available commands\n\n---\n\nCreate a complete help system with command-specific content, examples, and contextual guidance for all n-dx commands and subcommands"
---

## Subtask: Create hierarchical navigation with intelligent suggestions

**ID:** `1e0b3886-6d80-4987-8f81-b6c8e6b5ad08`
**Status:** completed
**Priority:** medium

Build a help system that supports drill-down navigation, command suggestions for typos, and searchable help content across all commands

**Acceptance Criteria**

- Main help shows command categories and navigation hints
- Users can access subcommand help from parent command help
- Related commands are suggested in help output
- Suggests similar commands for typos with edit distance matching
- Users can search help content with keywords
- Search results show matching commands with relevance scoring

---

## Subtask: Add navigation hints and related commands to help output

**ID:** `5df1865c-e076-475b-9c4c-b37000615d06`
**Status:** completed
**Priority:** medium

Enhance the main help in cli.js to include navigation hints (e.g., 'Run ndx <cmd> --help for details'). Add 'See also' related command suggestions to per-command help output in all three package help.ts files. Add subcommand help accessibility from parent command help (e.g., ndx rex --help shows rex commands with hint to drill down).

**Acceptance Criteria**

- Main help shows navigation hints like 'Run ndx <command> --help for details'
- Per-command help includes 'See also:' section with related commands
- Users can access subcommand help from parent command help (ndx rex --help → rex subcommands)

---

## Subtask: Implement typo correction with edit distance matching

**ID:** `ccff7d53-6a94-4821-b718-0446e4974293`
**Status:** completed
**Priority:** medium

Add Levenshtein edit distance matching to suggest similar commands when the user types an unrecognized command. Applies to both the orchestrator (cli.js) and per-package CLIs (rex, hench, sourcevision). Suggest commands within distance ≤ 2.

**Acceptance Criteria**

- Typing 'ndx statis' suggests 'ndx status'
- Typing 'rex valdate' suggests 'rex validate'
- Suggestions only shown when edit distance ≤ 2
- Works for all three package CLIs and orchestrator

---

## Subtask: Implement keyword search across all help content

**ID:** `5717ebd1-09f2-4f8e-a8af-38d39fb484e6`
**Status:** completed
**Priority:** medium

Add 'ndx help <keyword>' command to search across all help content (orchestrator + packages). Score results by relevance (title match > description match > option match). Display matched commands with context snippets showing why they matched.

**Acceptance Criteria**

- ndx help PRD returns commands related to PRD management
- ndx help sync returns the sync command with relevant context
- Results are scored and sorted by relevance
- Search covers orchestrator commands and all package commands

---

## Subtask: Build dynamic help content generation with comprehensive coverage

**ID:** `402ce915-dc9d-458a-9e58-107e1f334f8e`
**Status:** completed
**Priority:** high

Implement a system that generates contextual help content for all commands across rex, sourcevision, and hench packages with practical usage examples

**Acceptance Criteria**

- Each command shows relevant options and flags only
- Help content includes command-specific examples
- All rex, sourcevision, and hench subcommands have detailed help text
- Help includes parameter descriptions and examples
- Each command shows 2-3 practical usage examples
- Examples demonstrate common parameter combinations

---
