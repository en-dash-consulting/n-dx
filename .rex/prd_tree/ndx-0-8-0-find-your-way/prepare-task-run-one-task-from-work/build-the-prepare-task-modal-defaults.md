---
id: "379bf324-8797-49ca-8eba-f83e370dacdd"
level: "task"
title: "Build the Prepare task modal: defaults with sources, per-run overrides, preflight, equivalent command, brief preview and Execute"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "web-viewer"
blockedBy:
  - "70eb7e99-0376-4b5a-af41-1a4b4f52b6ac"
acceptanceCriteria:
  - "The modal renders every field from the prep response with its value and source, and marks changed fields with a reset control."
  - "The command line updates as fields change and matches the argv the server spawns for the same options (shared table, test)."
  - "Preflight lists each refusal and warning; Execute is disabled while a refusal stands and re-enabled when allow dirty tree clears a dirty-tree refusal."
  - "Execute sends only changed options; a started run navigates to /live/task/:taskId, a queued run shows its position from useHubQueue and a link to Live, errors show the server message, and a migratable 412 offers the migration."
  - "Preview brief shows the dry-run brief for the current options."
  - "/work/prep/:taskId opens the modal on reload, including under /p/<id>/ and /w/<key>/."
  - "Dialog semantics, focus trap, Escape to close and labelled controls are covered by tests."
  - "Patch changeset for @n-dx/web."
description: "A Preact modal component (packages/web/src/viewer/components/prepare-task-modal.ts or similar), fed by GET /api/hench/prep/:taskId.\n\nLayout, top to bottom: header (\"Prepare task\", the task title, parent chain, status, priority, criteria count, short id, close button); WHERE (workspace shown with branch; on the anchor say \"Commits land on main\" as a warning; when a run is already live in this worktree warn that two runs would share one working tree); MODEL (vendor read-only with its source; model select from `catalog`; provider select); BEHAVIOUR (adversarial review off/on, review model enabled only when review is on, permission mode, full test gate run/skip, session reuse/fresh, max turns — disabled with \"api provider only\" when provider is cli, token budget, notes for the agent → contextNotes; an Advanced disclosure with allow dirty tree). Every field shows its current value and its `source` from the resolve JSON; a field changed in the modal shows a dot, \"changed for this run\", and a per-field reset. PREFLIGHT: one line per refusal from the resolve JSON plus the workspace warnings and the hub admission state (queue will be used when memoryPaused or slots are full; show availableBytes and pressure, and say nothing alarming for pressure \"unknown\"). Execute is disabled while any refusal stands; dirty-tree refusal is cleared by ticking allow dirty tree. COMMAND: the equivalent `ndx work --task=<id> --auto <flags> <dir>` built with packages/web/src/shared/run-options.ts so it matches what the server will spawn, with a Copy button. FOOTER: \"N changes apply to this run only\" (there is no Save in this phase), Preview brief (POST …/preview, shown in a scrollable monospace panel with Back), Reset to defaults, Execute (label Resume for in-progress tasks).\n\nExecute posts {taskId, options} to /api/hench/execute (only changed fields). Results: started → close the modal and navigate to /live/task/:taskId; queued (202 with queued:true) → show \"Queued — position N\" with the reason, keep updating the position from useHubQueue (packages/web/src/viewer/hooks/use-hub-queue.ts, which has no consumer yet), and link to Live; 409/503 → show the server's message; 412 migratable → offer \"Migrate the PRD tree\" exactly as StartTaskButton does (components/start-task-button.ts:98-134). The recommendation slot renders nothing while `recommendation` is null.\n\nAccessibility: role=dialog, aria-modal, labelled by the title, focus moves into the dialog and is trapped, Escape and the close button close it and return focus to the opener; every control has a <label>. Deep link: /work/prep/:taskId (route-state.ts viewPathname/parsePathnameRoute) opens the Work page with the modal open, and closing it returns to /work; links go through appUrl() so the hub prefix is kept. Requests go through the viewer's base-path fetch; when opened for another workspace (from a Workspaces card) send X-Ndx-Workspace."
lastModified: "2026-10-02T04:55:22.470Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
