---
id: "c25fccb4-81ba-4446-b71f-73b1a2afdc6b"
type: "change"
title: "sv, rex and hench treat Object prototype names as orchestrator-only commands"
slug: "sv-rex-and-hench-treat-object"
intent: "The CLIs test `command in NDX_ONLY_COMMANDS`, which follows the prototype chain: `sv toString` prints `\"toString\" is an orchestrator command. Run: function toString() { [native code] } .`. Sites: packages/sourcevision/src/cli/index.ts (~177), packages/rex/src/cli/index.ts (~674–688), packages/hench/src/cli/index.ts (~97, ~265).\n\nReachable: yes, by typing a prototype name as a command.\n\nFix options: (1, recommended) use `Object.hasOwn(NDX_ONLY_COMMANDS, command)`; one line per site.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "`sv toString`, `rex constructor` and `hench toString` report an unknown command, not an orchestrator command"
  - "A test per CLI asserts the unknown-command path for a prototype name"
touches:
  - "6ba40421-b660-40fb-9c7d-70651bb863e1"
priority: "low"
source: "ndx-adversarial-review"
---
