---
id: "a93e8867-0dab-43d5-8270-f2a0f6dbb47f"
level: "task"
title: "The live-task view with no task id renders a blank page, reachable by closing Settings or deep-linking /live-task"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Navigating to `/live-task` with no id shows the Live overview, and the URL is /live (unit test)."
  - "Opening and closing Settings from /live/task/X returns to /live/task/X with the task page rendered (unit test)."
  - "`[` and `]` do nothing while the settings overlay or another modal is open."
  - "navigation.spec.ts deep-links /live/task/<fixture id> and /live/analyze with zero console errors."
description: "Failure: `packages/web/src/viewer/views/view-registry.ts:146-147` returns null when `selectedTaskId` is null, and `route-state.ts:31` maps (`live-task`, null) to `/live`. On /live/task/X, click the settings cog: `openSettings` (`main.ts`) calls `handleSidebarNav(\"llm-provider\")`, which clears taskId; the page underneath goes blank, and closing Settings returns to view `live-task` with no id, so the URL reads /live while the main area is empty. Deep-linking `/live-task` (exactly what `tests/e2e-ui/navigation.spec.ts` visits, since its VIEWS list is `Object.keys(VIEW_META)`) also gives an empty page and passes only because nothing throws. Separately, `]` still navigates behind the open Settings modal because the LiveBar is mounted on the page view and its typing check covers only inputs. No browser test ever opens `/live/task/:id` or `/live/analyze` by their canonical paths.\n\nReachability: opening Settings from a task page; any `/live-task` link. Verdict: must-fix (severity medium).\n\nOptions:\n- (a) Recommended: normalise {view:'live-task', taskId:null} to `live` when parsing and applying route entries, and have the registry fall back to LiveView. Small.\n- (b) Have closing Settings restore the last page's sub-ids. Small, but leaves the deep link blank.\nAlso: ignore `[` and `]` while a modal or the settings overlay is open, and add the canonical `/live/task/<fixture id>` and `/live/analyze` paths to navigation.spec.ts."
lastModified: "2026-10-01T15:21:47.028Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
