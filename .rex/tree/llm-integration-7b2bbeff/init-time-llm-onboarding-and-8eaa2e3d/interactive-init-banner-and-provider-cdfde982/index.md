---
id: "cdfde982-2b40-486b-915e-be886020c942"
level: "task"
title: "Interactive init banner and provider selection"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T05:23:23.023Z"
completedAt: "2026-02-21T05:23:23.023Z"
description: "Make `n-dx init`/`ndx init` guide first-time setup with a prominent terminal banner and a clear LLM provider picker so users can configure execution without manual config edits."
---

## Subtask: Render branded n-dx banner at init start

**ID:** `476515e5-ed60-4913-824f-478c2c82425b`
**Status:** completed
**Priority:** medium

Display a prominent, readable terminal banner before setup prompts so users immediately understand they are in the guided initialization flow.

**Acceptance Criteria**

- Running `n-dx init` displays a banner before any configuration questions
- Running `ndx init` displays the same banner output
- Banner output is suppressed when init is run in non-interactive mode

---

## Subtask: Present interactive LLM provider selection screen

**ID:** `413e986a-529e-42e4-a195-97bc5d835e4a`
**Status:** completed
**Priority:** critical

Add a user-friendly selection prompt during init that allows choosing `codex` or `claude` as the active provider.

**Acceptance Criteria**

- Init prompt lists exactly `codex` and `claude` as selectable providers
- Selecting an option persists provider config to project settings
- If the user cancels selection, init exits with a clear non-zero termination message

---

## Subtask: Persist selected provider through existing config pathway

**ID:** `d06f2688-c4e1-4f69-b7ac-78e0a13047c8`
**Status:** completed
**Priority:** high

Write provider choice via the unified configuration system so downstream packages resolve the same active vendor without custom init-only state.

**Acceptance Criteria**

- Selected provider is readable through existing config get command/path
- Subsequent commands use the selected provider without additional flags
- Automated test verifies both `codex` and `claude` selections persist correctly

---
