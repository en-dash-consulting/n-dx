---
id: "8ac55bc6-c995-479d-8043-935199d6b764"
level: "task"
title: "Rank placement candidates with rules and the text model"
status: "completed"
priority: "medium"
tags:
  - "pr-12"
  - "lane-rex-domain"
  - "rex"
  - "llm-client"
source: "roadmap"
startedAt: "2026-10-07T22:05:17.683Z"
completedAt: "2026-10-07T22:16:30.831Z"
endedAt: "2026-10-07T22:16:30.831Z"
resolutionType: "code-change"
resolutionDetail: "Added core/placement.ts (rules ranking + injected text-model seam, agreement detection), registered prd.place, tests, changeset."
acceptanceCriteria:
  - "A shortlist is returned with no model configured (test)"
  - "Agreement between rules and model is detected (test)"
description: "Rules: package and path mentions, title token overlap, file evidence looked up against realized by. Text model: prd.place task class, uncalibrated, so auto-accepted only when it agrees with the rules."
lastModified: "2026-10-07T22:16:31.064Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
