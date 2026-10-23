---
id: "94c99bdd-eda8-483a-9487-d7df9c4c466b"
type: "change"
title: "Phase 2 PR 4: save run settings from the Prepare task modal"
slug: "phase-2-pr-4-save-run-settings-from"
intent: "Prepare task phase 2, PR 4 of 4 (design §4 modal states, §5.2 PUT route, §6). PUT /api/hench/prep/:taskId saves or clears the task's run block in the request's workspace with a version check (409 on conflict); the modal gains Save, Reset to defaults, \"saved on task\" sources, the conflict state and the off-anchor notice; Ready to run rows show a saved dot."
touches:
  - "03266251-06ef-4864-960a-0cb02986ff1d"
plannedRelease: "0.9.0"
priority: "high"
tags:
  - "task-prep"
  - "0.9.0"
---
