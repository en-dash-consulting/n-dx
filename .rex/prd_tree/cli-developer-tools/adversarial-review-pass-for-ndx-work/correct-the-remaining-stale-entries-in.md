---
id: "85923733-a15e-45b7-9440-8b5ea0d5eb84"
level: "task"
title: "Correct the remaining stale entries in MODEL_COSTS"
status: "completed"
priority: "medium"
startedAt: "2026-08-28T18:00:23.782Z"
completedAt: "2026-08-28T18:01:21.666Z"
endedAt: "2026-08-28T18:01:21.666Z"
acceptanceCriteria: []
description: "MODEL_COSTS in llm-client drives budget preflight, so stale prices mis-estimate cost. claude-opus-4-7 is listed at 15.00/75.00 per MTok against a current 5.00/25.00 (a 3x over-estimate), and claude-haiku-4-5 at 0.80/4.00 against a current 1.00/5.00. TIER_MODELS.claude.heavy also still points at claude-opus-4-7. The opus-5 and opus-4-8 entries were added by the review-model work; these are the remainder, and the haiku figure matters more now that light-tier routing makes it a real cost input."
lastModified: "2026-08-28T18:01:21.673Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
