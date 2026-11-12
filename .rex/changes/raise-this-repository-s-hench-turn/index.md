---
id: "e923101f-1789-48af-b391-03c21f2d29bb"
type: "change"
title: "Raise this repository's hench turn limit from 50 to 200"
slug: "raise-this-repository-s-hench-turn"
intent: "This repository's committed .hench/config.json has set maxTurns: 50 since the initial commit, below hench's built-in default of 200. Multi-file tasks hit it: on 2026-11-12 two validation-gate wave 1 runs (tasks 9861a7ad and adb92a12) stopped at 50 turns after about four minutes with work half done. A saved task run.maxTurns cannot raise it, because saved settings may only tighten the operator's limit (saved-setting-widens), so only a --max-turns flag on each run got past it. Set it to 200, matching hench's default. Users on a tighter budget can still lower it with hench.maxTurns, a saved task run.maxTurns or --max-turns; tokenBudget and the spend caps remain the direct cost controls."
acceptanceCriteria:
  - "This repository's .hench/config.json sets maxTurns to 200"
  - "ndx work --task=<id> --resolve . reports maxTurns 200 from hench.maxTurns with no flag"
touches:
  - "6b0c3873-5607-4adc-9027-abd8d70ab0e3"
priority: "medium"
source: "ndx-capture"
---
