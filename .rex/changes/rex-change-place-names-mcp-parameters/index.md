---
id: "f50da51a-6e3e-4f88-a778-0c67eb92bd17"
type: "change"
title: "rex change place names MCP parameters, not CLI flags, when it refuses a summary-only amends placement"
slug: "rex-change-place-names-mcp-parameters"
intent: "Found merging PR 17 into PR 18 (c05eaadd9). Since c3c42584, change-place refuses an amends placement that carries no proposed text and no capability-criteria delta, with the message \"nothing to modify: no proposed text or criteria delta. Pass proposed or criteria, or use relation touches\". That wording names the MCP place_change parameters and uses a bare \"criteria\". From the CLI (`rex change place <change> --target=<node> --relation=amends`), the user needs the flags: --proposed, --capability-criterion, --remove-capability-criterion, or --relation=touches.\n\nFix in the CLI layer (packages/rex/src/cli/commands/change.ts): when the placement error is the nothing-to-modify refusal, attach a suggestion naming the CLI flags, as the apply path did before. Leave the core/MCP message unchanged (MCP tool shapes and messages are PR 17's), except for the PR 18 terminology rule if it can change without breaking MCP tests; say which in the commit.\n\nThe previous CLI test for this hint (product-change-v2.test.ts, apply path) was rewritten in the merge to assert the refusal only."
acceptanceCriteria:
  - "rex change place with --relation=amends and no content is refused with a suggestion naming --proposed, --capability-criterion and --relation=touches (test)"
  - "The CLI refusal never uses a bare \"criteria\""
touches:
  - "70443075-8352-48a4-a8ed-799505872d4b"
priority: "low"
source: "merge-pr17-into-pr18"
---
