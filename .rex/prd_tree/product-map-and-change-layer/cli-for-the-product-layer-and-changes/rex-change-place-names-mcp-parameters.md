---
id: "f50da51a-6e3e-4f88-a778-0c67eb92bd17"
level: "task"
title: "rex change place names MCP parameters, not CLI flags, when it refuses a summary-only amends placement"
status: "completed"
priority: "low"
source: "merge-pr17-into-pr18"
startedAt: "2026-10-09T16:06:08.565Z"
completedAt: "2026-10-09T16:12:37.411Z"
endedAt: "2026-10-09T16:12:37.411Z"
resolutionType: "code-change"
resolutionDetail: "Run d31e15f8 (claude-sonnet-5-5, review claude-opus-5-5), commit(s) bd66bef95; stale dist only; gate re-run green after rebuild (node scripts/run-all-tests.mjs affected b90e7c876, 4/4 suites passed). Closed by the overnight Lane A session."
acceptanceCriteria:
  - "rex change place with --relation=amends and no content is refused with a suggestion naming --proposed, --capability-criterion and --relation=touches (test)"
  - "The CLI refusal never uses a bare \"criteria\""
description: "Found merging PR 17 into PR 18 (c05eaadd9). Since c3c42584, change-place refuses an amends placement that carries no proposed text and no capability-criteria delta, with the message \"nothing to modify: no proposed text or criteria delta. Pass proposed or criteria, or use relation touches\". That wording names the MCP place_change parameters and uses a bare \"criteria\". From the CLI (`rex change place <change> --target=<node> --relation=amends`), the user needs the flags: --proposed, --capability-criterion, --remove-capability-criterion, or --relation=touches.\n\nFix in the CLI layer (packages/rex/src/cli/commands/change.ts): when the placement error is the nothing-to-modify refusal, attach a suggestion naming the CLI flags, as the apply path did before. Leave the core/MCP message unchanged (MCP tool shapes and messages are PR 17's), except for the PR 18 terminology rule if it can change without breaking MCP tests; say which in the commit.\n\nThe previous CLI test for this hint (product-change-v2.test.ts, apply path) was rewritten in the merge to assert the refusal only."
lastModified: "2026-10-09T16:12:37.655Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
