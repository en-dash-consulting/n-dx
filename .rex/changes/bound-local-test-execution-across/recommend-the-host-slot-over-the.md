---
id: "6b308b56-b70f-4490-ae86-bd1e421dc074"
type: "task"
title: "Recommend the host slot over the worker cap for parallel worktrees in the docs"
slug: "recommend-the-host-slot-over-the"
summary: "The docs tell people running several worktrees to cap test workers and turn on the shared validation slot together, but the benchmark showed the slot alone prevents the failures and is up to twice as fast. This updates the guidance so people pick the setting that works best."
description: "PR 4 (validation benchmark) follow-up. The 2026-11-13 benchmark (cases A–H, three worktrees gating at once on a 16 GiB M2, one repeat) found:\n- Failed runs: neither 4/9, cap 2 only 1/9, host slot only 0/9, cap 2 + slot 0/9.\n- With the slot on, removing the cap cut batch time by 19–48% (hench 8.6 → 7.0 min, llm-client 27.5 → 15.2, web 10.0 → 5.2); the cap makes each run 43–102% slower.\n- Slot-only peak test memory 1.9–2.7 GiB, about half of running unbounded.\nSo `.n-dx.json` now sets `hench.testGate.hostSlot: true` and no `maxWorkers` (operator commit 214f0e57f). The docs still present the cap as the companion to the slot. Update them so the guidance is: for several worktrees on one machine, turn on the host slot; use the worker cap where suites run outside the slot — an agent's own shell commands (the slot does not serialize those), `scripts/run-all-tests.mjs --no-slot`, machines that leave the slot off, and CI.\n\nEdit, keeping each change short (the AGENTS.md/docs size budgets apply; do not add new sections where a sentence does):\n- TESTING.md, \"Capping Test Workers\": the paragraph suggesting `export NDX_TEST_MAX_WORKERS=2` in the shell profile for several worktrees — reframe as the option for runs that bypass the slot.\n- TESTING.md, \"Running Several Worktrees at Once\": it says to set `NDX_TEST_MAX_WORKERS` and turn on the slot. Lead with the slot; mention the cap only for what the slot does not cover. One sentence citing the benchmark result (slot alone: no failures, and 19–48% faster than slot + cap) is enough; point to the benchmark section further down rather than repeating its table.\n- docs/guide/configuration.md (`hench.testGate.maxWorkers` around line 283 and `hostSlot` around 289): say when to use each, consistent with the above. The slot paragraph's \"only `hench.testGate.maxWorkers` bounds those\" stays true; keep it.\n- docs/packages/hench.md lines 161–162: same adjustment; drop the implication that the cap is the fix for several worktrees gating at once.\n- scripts/bench/lib/plan.mjs: the comment on `PILOT_MAX_WORKERS` says it is \"the test worker cap the pilot uses (`hench.testGate.maxWorkers` in this repository)\". This repository no longer sets it. Reword the comment to say it is the cap value the benchmark measures (the original wave 1 pilot). Do not rename the constant.\n\nDo not change behaviour, defaults, `.n-dx.json`, or tests' expectations. No changeset (docs and repository tooling only). Run the static root policy tests (instruction-alignment, agents-md size budget, docs link checks if any) before finishing. Operator notes: no `process.env.NDX_*` writes in tests; no benchmark runs."
acceptanceCriteria:
  - "TESTING.md, docs/guide/configuration.md and docs/packages/hench.md recommend the host slot for several worktrees on one machine and the worker cap for runs that bypass the slot (agent shell commands, --no-slot, machines without the slot, CI)"
  - "TESTING.md cites the benchmark result in at most a sentence and links the benchmark section instead of repeating its data"
  - "The PILOT_MAX_WORKERS comment in scripts/bench/lib/plan.mjs no longer says this repository sets hench.testGate.maxWorkers"
  - "No behaviour, default, config or test expectation changes; static root policy tests pass"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-4-benchmark"
  - "docs"
source: "ndx-capture"
---
