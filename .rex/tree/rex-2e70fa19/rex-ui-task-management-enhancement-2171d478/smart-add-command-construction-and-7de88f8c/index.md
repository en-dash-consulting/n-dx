---
id: "7de88f8c-5bee-4b9e-9532-7f134c7244ed"
level: "task"
title: "Smart Add Command Construction and Submission UX Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T18:14:07.762Z"
completedAt: "2026-03-06T18:14:07.762Z"
acceptanceCriteria: []
description: "Two related regressions in the Rex Dashboard Smart Add form: (1) the CLI command is being built incorrectly, appending stale or unrelated text from the UI (e.g. a previous task title) to the `add` subcommand arguments, causing a command-not-found failure; (2) the form auto-submits on every keystroke or Enter press rather than waiting for the user to finish composing their input."
---

## Subtask: Fix Smart Add CLI command argument construction in Rex Dashboard

**ID:** `7185db68-f9b1-473a-982d-1d169dd5d880`
**Status:** completed
**Priority:** critical

The Rex Dashboard Smart Add feature builds a shell command like `rex add --format=json <description>` before dispatching it to the CLI. A regression is causing the description argument to be concatenated with unrelated UI state (e.g. the current search query or last-focused task title), producing a malformed command such as `rex add --format=json limit Tag selection options in the rex task UI search area`. Trace the command-builder code path, identify the source of the stale string injection, and fix the argument assembly so only the user-entered description is forwarded.

**Acceptance Criteria**

- Submitting a Smart Add description dispatches exactly `rex add --format=json <user-description>` with no extra text appended
- The error 'Command failed: … add --format=json <unrelated-text>' no longer appears in the dashboard for any input
- Verified by submitting a short description while a different task or search term is visible on screen — the dispatched command contains only the typed description
- Existing Smart Add integration test suite passes without modification

---

## Subtask: Prevent Smart Add form auto-submission and require explicit user action

**ID:** `ebb0e5f8-32e7-4494-a680-8b16ac5603e5`
**Status:** completed
**Priority:** high

The Smart Add input form in the Rex Dashboard currently submits automatically — either on each keystroke (reactive binding) or on Enter key press — before the user has finished composing their description. This makes it impossible to type multi-word or multi-clause ideas without triggering a premature submission. The form should only submit when the user explicitly clicks the Submit button (or equivalent deliberate action). Debouncing alone is insufficient; the trigger must be user-initiated.

**Acceptance Criteria**

- Typing any text into the Smart Add input does not trigger proposal generation or CLI dispatch
- Pressing Enter while focused in the Smart Add input does not submit the form
- The form submits only when the user activates the designated Submit/Generate button
- A user can type, pause, edit, and resume typing before submitting without any interim API calls or errors
- Submission button is visually distinct and reachable via keyboard (Tab + Enter/Space)

---
