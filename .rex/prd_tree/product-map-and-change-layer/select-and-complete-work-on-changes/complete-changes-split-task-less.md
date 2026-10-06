---
id: "3d03ab41-df50-4235-a057-f48a8af00ce7"
level: "task"
title: "Complete changes, split task-less changes and trigger apply"
status: "pending"
priority: "high"
tags:
  - "pr-16"
  - "lane-rex-domain"
  - "rex"
blockedBy:
  - "b0467938-b793-41ee-923d-cfd5c57322df"
source: "roadmap"
acceptanceCriteria:
  - "Completing the last task applies the change under applyOn complete (test)"
  - "The split rule moves criteria to the new first task (test)"
description: "A change completes when its tasks do (or on its own when task-less) and apply runs per rex.applyOn. When a task-less change in progress gains its first task, the in-flight work becomes that task carrying the change's criteria."
lastModified: "2026-10-06T04:19:46.327Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
