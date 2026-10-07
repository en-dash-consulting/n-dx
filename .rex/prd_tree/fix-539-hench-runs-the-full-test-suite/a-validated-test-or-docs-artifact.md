---
id: "e51ab955-ced4-46c3-83af-5974d289535a"
level: "task"
title: "a validated test or docs artifact changed on its own selects the suite that checks it"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "Source: adversarial review of fix/539-scoped-test-gate (#546) by Hal, posted on #530 on 2026-10-07. Finding F2, severity medium.\n\nFailure: the Markdown short-circuit in scripts/lib/select-suites.mjs:191 runs before the ROOT_PREFIXES check, so a change made only of Markdown or docs/ files selects no suite, even when a root test validates that file. Measured: [tests/shell-spawn-inventory.md] selects []; [docs/analysis/prompt-token-baseline.json] selects []. tests/e2e/shell-spawn-inventory-policy.test.js checks the first and tests/e2e/prompt-census.test.js checks the second. Only bites when such a file is the whole change. Also part of the unfinished half of e3c0e72f.\n\nApproach (recommended): a small validated-artifact path list (tests/*.md, docs/analysis/prompt-token-baseline.*) that selects root-policy instead of nothing, with the tests that read them folded into root-policy as in the F1 task. Do not reorder the checks so that every tests/ Markdown edit selects full root.\n\nAcceptance criteria:\n- selectAffected([tests/shell-spawn-inventory.md]) selects the suite that runs shell-spawn-inventory-policy, pinned by a unit test.\n- selectAffected([docs/analysis/prompt-token-baseline.json]) selects the suite that runs prompt-census, pinned by a unit test.\n- A plain docs edit with no validated artifact (docs/guide/skills.md) still selects nothing, pinned by a unit test.\n- TESTING.md's Markdown rule is corrected to name the exception."
lastModified: "2026-10-07T16:16:53.574Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
