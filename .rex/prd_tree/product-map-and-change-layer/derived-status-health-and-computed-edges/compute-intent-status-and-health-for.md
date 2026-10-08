---
id: "277ca835-dd06-41ef-90c0-b2f026843880"
level: "task"
title: "Compute intent status and health for product nodes"
status: "completed"
priority: "medium"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
startedAt: "2026-10-07T23:11:44.842Z"
completedAt: "2026-10-07T23:36:33.241Z"
endedAt: "2026-10-07T23:36:33.241Z"
acceptanceCriteria:
  - "Each status and health value has a fixture test"
  - "Status is never written to intent files"
description: "Intent: proposed, changing (open amendment), met (hash equals metAt and checks pass), revised (hash differs, no open change), retired. Health: defective when an open fix touches it or a check fails, otherwise ok. Constraints get health too."
lastModified: "2026-10-07T23:36:33.494Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
