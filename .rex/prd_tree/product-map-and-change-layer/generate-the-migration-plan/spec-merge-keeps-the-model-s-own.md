---
id: "d08aed52-edf6-467b-ab62-b84e9a4f12a7"
level: "task"
title: "Spec merge keeps the model's own subject instead of wrapping it in \"The system shall ensure that\""
status: "in_progress"
priority: "medium"
source: "live-run"
startedAt: "2026-10-09T05:24:43.658Z"
acceptanceCriteria:
  - "A merged model criterion that already says \"<subject> shall …\" or \"When/While/If … shall …\" is stored unchanged (test)"
  - "A merged model criterion \"The inventory lists every prompt surface\" is stored as \"The inventory shall list every prompt surface\" (test)"
  - "A merged model criterion whose verb cannot be converted is stored as written, never prefixed with \"The system shall ensure that\" (test)"
  - "The spec-draft prompt asks for \"shall\" in every criterion (test on the envelope text), and the prompt-token baseline matches the new prompt (prompt-census test passes)"
description: "From the second sampled live run of 2026-10-09 (same 5 epics; text placement, Jev review only). The text model wrote 0 criteria opening \"The system shall ensure that\" (58da244f's prompt works), but 25 of the 111 stored criteria open that way: 29 model criteria are present-tense sentences without \"shall\", such as \"The inventory lists every LLM prompt surface…\", and the spec merge passes every accepted criterion through toEars (packages/rex/src/migrations/v1-to-v2/spec-pass.ts:182), which wraps them as \"The system shall ensure that the inventory lists…\". 58da244f normalised only the \"ensure that the system\" form.\n\nFix both ends: the spec-draft prompt (packages/rex/src/analyze/spec-draft-reason.ts) asks for \"shall\" in every criterion (or When/While/If … shall), and the merge turns a subject-led present-tense sentence (\"The X lists Y\") into \"The X shall list Y\" when the verb converts, and otherwise keeps the model's sentence as written rather than wrapping it. The prompt change moves the prompt-token baseline: re-record it with `node scripts/prompt-census.mjs --write` on a clean tree after committing, and commit the baseline separately.\n\nDecision (Ryan, 2026-10-09): fix in PR 13.\n\nBefore finishing, run `pnpm --filter @n-dx/rex build`, and run it again after any review repair that edits rex source: the affected test gate refuses a stale rex dist/, and hench does not rebuild before it."
lastModified: "2026-10-09T05:24:43.921Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
