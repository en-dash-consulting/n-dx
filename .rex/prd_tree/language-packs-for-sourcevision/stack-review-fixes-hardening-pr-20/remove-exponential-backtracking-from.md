---
id: "c8bde891-9d47-4120-ba47-1047a85f5324"
level: "task"
title: "Remove exponential backtracking from Python requirement specifier parsing"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "security"
  - "lang-kit"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T09:21:56.177Z"
completedAt: "2026-10-17T09:28:17.630Z"
endedAt: "2026-10-17T09:28:17.630Z"
resolutionType: "code-change"
resolutionDetail: "SPEC separator made unambiguous (\\s*(?:,\\s*)?); #egg= lookup anchored to the first #; regression tests added."
acceptanceCriteria:
  - "Requirement specifier parsing is linear in the input; a pathological 100+ character spec returns promptly"
  - "Other regexes in the Python build readers audited for the same shape"
  - "python-build-report output unchanged on the corpus"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them. Per the repo's wall-clock policy, bound cost by counting work or by a generous time limit only where the repo already does so; prefer an input-size/step-count assertion."}
description: "Stack review (#793, packages/lang-kit/src/python-requirements.ts around line 72), a live path. Between two clauses, `\\s*,?\\s*` can split the same whitespace k+1 ways, so a failing tail backtracks as (k+1)^m. The input is any repo line read here: requirements.txt, [project].dependencies, setup.cfg install_requires, or a literal install_requires. Measured with the regex on `\"==1  \".repeat(m) + \"x\"`: m=14 takes 0.5 s, m=16 takes 1.1 s, and m=18 (a 91-character line) about 10 s. It blocks the event loop inside forProject, so the pack's degrade path (a try/catch) can't recover.\n\nFix: make the separator unambiguous, e.g. `clause(?:\\s*,\\s*clause)*`, or split on `,` and test each clause with a linear regex. Audit the other regexes in python-requirements.ts and python-build.ts for the same shape. Add a test with the pathological specifier that would hang before the fix; bound it per the repo's wall-clock policy, with a step count or a generous time limit. Parsing results for the corpus must be unchanged (the session runs python-build-report)."
lastModified: "2026-10-17T09:28:17.947Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
