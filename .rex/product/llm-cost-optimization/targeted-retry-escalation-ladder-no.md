---
id: "7fa8f031-c652-4caf-8dfe-58293d384a5e"
type: "capability"
title: "Targeted retry escalation ladder — no more identical-prompt retries"
slug: "targeted-retry-escalation-ladder-no"
statement: "When an LLM call returns invalid, refused or semantically failing output, the LLM client retries it once on the standard model with the validation error appended to the prompt, instead of resending an identical prompt."
criteria: [{"id":"c1","text":"If an attempt's output fails parsing or validation, the LLM client shall append the validation or parse error to the prompt for the second attempt, and shall never resend a byte-identical prompt."},{"id":"c2","text":"The LLM client shall make at most two attempts per call, the first on the routed model and the second on the standard tier."},{"id":"c3","text":"If the second attempt also fails, the LLM client shall return the failure to the caller."},{"id":"c4","text":"Before the LLM client accepts an attempt, it shall run that call class's semantic checks in pure code, without any LLM call."},{"id":"c5","text":"When a call fails from context overflow, sourcevision shall apply its prompt-degradation ladder, and when a call fails from lack of model capability, the LLM client shall apply model escalation."},{"id":"c6","text":"The LLM client shall record for each call whether it escalated, so that the escalation rate can be reported per call class."},{"id":"c7","text":"The LLM client shall read escalation behaviour from the llm.escalation configuration, including its enabled and maxSteps settings."}]
tags:
  - "rex"
  - "llm-client"
  - "retries"
  - "escalation"
source: "ndx-capture"
priority: "medium"
---

Rex resends a byte-identical prompt up to 3× on parse failure with no error feedback (audit R4; modify-reason.ts:217). Replace with the design's §06 escalation ladder: attempt 1 on the routed (light) model with a strict JSON output contract; on invalid/refused/semantically-failing output, attempt 2 on the standard model with the same prompt plus the validation error appended; no third attempt. Per-class semantic checks are pure code (decompose children non-empty and within bounds, renames yield two non-identical strings, guard verdict within enum). Sourcevision's prompt-degradation ladder is retained for context-overflow failures — the failure class decides which ladder applies. Record escalated: true per call so blended cost per class is measurable; a class escalating >20% of the time gets its default promoted to standard.
