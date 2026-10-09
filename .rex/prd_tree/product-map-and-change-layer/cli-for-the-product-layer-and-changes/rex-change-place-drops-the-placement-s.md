---
id: "3c6b277f-cb2a-4f8c-89a5-4011540a3b91"
level: "task"
title: "rex change place drops the placement's pending warnings, so the CLI user is not told apply will refuse until other changes close"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex change place that stores a placement with pending problems prints a warning naming the blocking change(s) and `rex change apply` (test)"
  - "rex change place --format=json includes the warnings (test)"
  - "No CLI warning text names apply_change or another MCP tool"
  - "place_change MCP warning text is unchanged"
description: "Out-of-scope finding from the adversarial review of 93d19cfa. Pre-existing.\n\nScenario: place an amends on a capability another open change also amends in a conflicting way. recordPlacement stores it and returns `warnings` (pendingWarnings, core/apply-amendments.ts:~167: \"..., so apply_change refuses until it is applied or closed: ...\"). cli/commands/change.ts:114-115 prints only \"Placed ...\" (text) or `{change, ...placement}` (json); `placed.warnings` is never shown. The user learns of the block only at `rex change apply`.\n\nAlso: the warning text itself names the MCP tool apply_change, so a CLI rendering needs its own wording (`rex change apply`), not the core string.\n\nReachable: `rex change place --relation=amends` while another open change has a pending conflict. Verdict: out-of-scope, medium (silent omission of a known future refusal).\n\nOptions: (1) print warnings via warn() in text mode and include `warnings` in JSON, with CLI wording naming `rex change apply` (needs a structured warning, e.g. blockedBy ids, rather than the MCP string) — recommended. (2) Print the core string as-is — cheap but names apply_change.\n\nDecided (Ryan, 2026-10-09): option 1. rex change place prints the placement's pending warnings with warn() in text mode and includes them in --format=json. The CLI words them itself, naming the blocking change(s) and `rex change apply`. To do that, recordPlacement passes through the structured pending problems and blockedBy ids (applyAmendmentsProblems already returns them since f7e0ceb7) beside the existing warning strings, instead of the CLI parsing the MCP sentence. The MCP place_change warning text stays byte-identical."
lastModified: "2026-10-09T17:19:09.991Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
