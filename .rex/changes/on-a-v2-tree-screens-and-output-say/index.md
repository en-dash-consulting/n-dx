---
id: "c1cea4f6-bf60-4e78-a038-49994901772f"
type: "change"
title: "On a v2 tree, screens and output say change and task consistently, and a change that runs as one task can be started"
slug: "on-a-v2-tree-screens-and-output-say"
intent: "Phase P1 of the change, task and branch design (workshop analysis/change-task-branches/README.md, draft 2; decisions CT1–CT3, all made 2026-11-05). A non-technical tester could not tell a change from the tasks ndx work runs (user testing 2026-11-05, finding N8). The stored names stay (CT1); what people read changes. On a v2 tree: a change is what should be different when it is done; a task is one step ndx work runs to make it, always shown inside its change; a change with no tasks \"runs as one task\" and can be started like one (CT2). Every runnable row names its change. No v1 word (epic, feature) appears on a v2 screen; the v1 projection (rex/src/core/layer-projection.ts:46, a root change projects to epic, a nested one to feature) leaks them today. The colliding helper words are renamed on screen: the Sidecar's \"change set\" card becomes \"PRD edits\", and the plan-queue \"lane\" becomes \"track\" (CT3). The Plan page redesign stack (#961–#967, #980) renames and moves some of these views; keep edits to labels and copy so a later restack stays simple."
acceptanceCriteria:
  - "No v2 screen shows epic or feature, and the glossary defines change, task, subtask, Inbox and runs as one task (viewer tests)"
  - "A change with no tasks can be started and given run settings from the dashboard (tests)"
  - "hench, rex help and printed output name a change as a change (tests)"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
  - "4ca9aac4-cd85-4af3-96d9-c4274e2d9f83"
priority: "medium"
source: "ndx-capture"
---
