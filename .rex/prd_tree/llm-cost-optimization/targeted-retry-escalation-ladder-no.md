---
id: "7fa8f031-c652-4caf-8dfe-58293d384a5e"
level: "feature"
title: "Targeted retry escalation ladder — no more identical-prompt retries"
status: "completed"
priority: "medium"
tags:
  - "rex"
  - "llm-client"
  - "retries"
  - "escalation"
blockedBy:
  - "462b9503-b036-41ce-a07e-380e4137bf73"
source: "ndx-capture"
startedAt: "2026-08-31T16:12:14.578Z"
completedAt: "2026-08-31T16:23:04.313Z"
endedAt: "2026-08-31T16:23:04.313Z"
acceptanceCriteria:
  - "No retry path resends a byte-identical prompt; the second attempt appends the validation or parse error to the prompt"
  - "Escalation runs at most two attempts: routed model, then the standard tier; further failure surfaces to the caller"
  - "Per-class semantic checks (pure code, no LLM) run before an attempt is accepted"
  - "Sourcevision's prompt-degradation ladder still handles context-overflow failures; model escalation handles capability failures"
  - "Each call records whether it escalated, enabling per-class escalation-rate reporting"
  - "Escalation behavior is configurable via llm.escalation (enabled, maxSteps)"
description: "Rex resends a byte-identical prompt up to 3× on parse failure with no error feedback (audit R4; modify-reason.ts:217). Replace with the design's §06 escalation ladder: attempt 1 on the routed (light) model with a strict JSON output contract; on invalid/refused/semantically-failing output, attempt 2 on the standard model with the same prompt plus the validation error appended; no third attempt. Per-class semantic checks are pure code (decompose children non-empty and within bounds, renames yield two non-identical strings, guard verdict within enum). Sourcevision's prompt-degradation ladder is retained for context-overflow failures — the failure class decides which ladder applies. Record escalated: true per call so blended cost per class is measurable; a class escalating >20% of the time gets its default promoted to standard."
lastModified: "2026-08-31T16:23:04.318Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
