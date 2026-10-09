---
id: "bd1c46d8-e15d-4fd4-a9e4-973d914121d3"
level: "task"
title: "The template statement check accepts an imperative after a leading clause and a noun-phrase work note as present-tense statements"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-13"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "isPresentTenseStatement rejects \"When hench produces a commit, append a structured trailer block\" (test)"
  - "isPresentTenseStatement rejects \"Follow-up to PR #370 review (findings 1, 2, 10).\" and \"Found by running the #370 follow-up queue on 2026-09-12.\" (test)"
  - "isPresentTenseStatement still accepts every fixture in the isPresentTenseStatement describe block of capability-spec.test.ts (test)"
description: "Verdict: should-fix (low). Found by the adversarial review of task 1ba34994 (statement check accepts product vocabulary).\n\nScenario: on the rules-only path (no text model, or the model's statement rejected), draftStatement (packages/rex/src/migrations/v1-to-v2/capability-spec.ts, isPresentTenseStatement) takes a feature description's first sentence as the capability statement. On this repo's tree, dropping the \"the task/change/item/PR\" rule newly accepts two wrong template statements:\n- \"N-DX Authorship and Model Audit Trailer\": \"When hench produces a commit, append a structured trailer block …\" (imperative after a When-clause; opensWithWorkVerb checks only the lead word).\n- \"v2 schema and rules before the freeze\": \"Schema and rule corrections from the pre-freeze review of PRs 10, 11 and 12 …\" (noun phrase, no verb).\nBoth were rejected before only by accident, because they contained \"the change\" or \"the PR\". The check already accepted similar text, for example \"Follow-up to PR #370 review (findings 1, 2, 10).\" and \"Found by running the #370 follow-up queue on 2026-09-12.\", across about 15 capabilities. Reachable via `ndx migrate --plan` without a configured text model. A human reviews the plan, so this is a wrong draft, not a silent data change.\n\nOptions:\n1. Apply opensWithWorkVerb to the main clause after a leading When/After/Before/If clause, and reject provenance openers (\"Found by\", \"Follow-up to\", \"P2 follow-up\", \"Discovery Option\"). Cheap; covers the observed cases. Recommended.\n2. Require a finite verb in the sentence (third-person -s or a known present-tense verb). Catches noun-phrase notes but risks false rejections."
lastModified: "2026-10-09T14:55:49.485Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
