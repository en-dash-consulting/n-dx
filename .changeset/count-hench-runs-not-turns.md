---
"@n-dx/rex": patch
---

`ndx usage` counts hench runs, not turns. The By-command breakdown summed one call per turn and printed it as "runs", so a batch of 10 runs could report 1,851 — disagreeing with the By-package line for the same tokens. Hench usage now carries both counts: `runs` (distinct run records, printed as the human unit) and `calls` (LLM calls, i.e. turns, kept in `--format=json` so nothing downstream loses the turn count). Package, per-command, and per-period surfaces all report the same run count for the same data.
