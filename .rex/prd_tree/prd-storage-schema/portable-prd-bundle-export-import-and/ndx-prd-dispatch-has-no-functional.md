---
id: "3e512e8b-b6d3-46eb-bba4-19f049e2829d"
level: "task"
title: "`ndx prd` dispatch has no functional test coverage"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "test-coverage"
source: "ndx-adversarial-review"
startedAt: "2026-09-10T17:21:05.058Z"
completedAt: "2026-09-10T17:24:48.593Z"
endedAt: "2026-09-10T17:24:48.593Z"
resolutionType: "code-change"
resolutionDetail: "ndx prd now has functional e2e coverage (round trip, missing/unknown subcommand including prototype-property names) and handlePrd's subcommand lookup is own-property-only via Object.hasOwn."
acceptanceCriteria:
  - "An e2e test spawns `ndx prd export` and `ndx prd import` against temp projects and asserts a successful round trip through the orchestrator tier"
  - "The test pins the missing-subcommand and unknown-subcommand error messages, including a prototype-property name such as `constructor`"
  - "`handlePrd` rejects non-own-property subcommands (Object.hasOwn or a Map) so `ndx prd constructor` reports an unknown subcommand"
description: "Verdict: should-fix (severity low, test-coverage). Found by adversarial review of the portable-prd-bundle branch diff.\n\nGap: no test anywhere spawns `ndx prd export` or `ndx prd import`. `handlePrd` (packages/core/cli.js:~2391) does positional token-slicing to find the subcommand, drops it by index so a directory named \"export\" still works, maps `import` → rex `import-bundle`, and forwards flags — exactly the code a refactor breaks without any suite noticing. The passing cli-arg-contracts tests only verify help-registry text; all functional bundle coverage lives at the rex tier.\n\nRider worth folding into the same change (reviewed as not-worth-fixing standalone): `PRD_SUBCOMMANDS[sub]` is a plain-object lookup, so `ndx prd constructor` resolves the inherited Object constructor (truthy) and spawns a stringified function as a rex command instead of printing \"Unknown 'ndx prd' subcommand\". A one-line `Object.hasOwn(PRD_SUBCOMMANDS, sub)` guard fixes it.\n\nSolution: a small e2e in tests/e2e/ that inits a temp project, runs `ndx prd export --out=…`, imports into a second temp project, asserts the round trip, and pins the missing-subcommand and unknown-subcommand error paths (including a prototype-property name like `constructor`)."
lastModified: "2026-09-10T17:24:48.620Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
