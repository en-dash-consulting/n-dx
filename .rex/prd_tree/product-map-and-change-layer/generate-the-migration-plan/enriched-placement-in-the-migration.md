---
id: "0734e6b6-9223-4669-8df7-058cf683f10d"
level: "task"
title: "Enriched placement in the migration plan: text by default, Jev when configured"
status: "pending"
priority: "high"
blockedBy:
  - "ab7b00bb-b362-44d9-917f-23fb0f4e85dd"
  - "bb2a3276-35bc-454b-9eed-6033f6ec63a3"
acceptanceCriteria: []
description: "The v1-to-v2 classifier uses only the rules ranking from core/placement.ts. decidePlacement (core/placement-policy.ts, PR 12) already takes a text-model seam and a Jev seam, reads rex.placement.models and rex.placement.autoAccept, and has no caller. Make placement a pass in the migrations pipeline that calls decidePlacement; reuse it, do not reimplement it.\n\nText is on by default and goes through @n-dx/llm-client like rex's other LLM tasks. Jev runs when rex.placement.models is jev or both and a TypeSafe key is present. With no model available (or an explicit rules-only option) the plan is the rules-only plan. Every model answer is recorded in the plan file (see the migrations framework task).\n\nAcceptance criteria:\n1. With the text seam mocked, a change the rules hold is placed when the text pick is accepted under autoAccept, and its entry records the pass and model (test).\n2. With models jev or both and a mocked judge, the entry carries Jev's pick and confidence; a pick that fails the accept rule stays held with needsPlacement (test).\n3. With no seam available the plan equals the rules-only plan (test).\n4. A new-node proposal from the text model is never auto-accepted and always leaves needsPlacement set (test).\n5. Tests never call a live model or Jev."
lastModified: "2026-10-08T19:54:04.125Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
