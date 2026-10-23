---
id: "2b5ff0ac-509b-4c0a-85ac-423a469d8c58"
type: "task"
title: "The manual flows' headSha assertion is vacuous: the baseline is taken before the spec's own commitAll"
slug: "the-manual-flows-headsha-assertion-is"
description: "Severity: medium (a test that does not protect the behaviour it names). Verdict: must-fix (one-line each).\n\nFAILURE SCENARIO\nprompt-to-completion.spec.ts takes baseSha = headSha(dir) at line 54, then commitAll(dir, \"accept smart-add proposal\") at line 86 moves HEAD, then after the run asserts headSha !== baseSha. analyze-add-complete.spec.ts does the same (baseline line 90, commitAll at 103 and 113). The assertion therefore passes even when the agent committed nothing — autoCommit off, or a run that the gate let through — so \"the agent landed a commit\" is asserted only by appearance.\n\nSOLUTION: capture the baseline immediately before clicking Start now, after the last spec-side commitAll; keep the post-run assertion. Optionally also assert the new HEAD carries the N-DX-Item trailer for the started task."
acceptanceCriteria:
  - "Both specs take the git baseline after their last commitAll and immediately before Start now"
  - "The post-run assertion fails when the fixture's HEAD is unchanged by the run (verified by temporarily reverting the baseline placement during the fix)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
---
