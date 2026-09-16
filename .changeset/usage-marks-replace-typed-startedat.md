---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Skill runs measure their token usage from a mark written by code, not a timestamp typed by the model. New `hench usage mark --task=<id>` snapshots the Claude Code session transcript's cumulative usage and position when a task starts (`hench usage marks` lists pending ones); `hench record --task=<id>` then claims exactly the difference between that snapshot and the transcript at record time, per token class, printing both positions and a fresh-work subtotal beside the cache-read total. `--startedAt` is now the run's start time only (defaulting to the mark's) and never selects usage; `--since` remains an explicit window; `--mark=<id>` consumes a mark taken under another name. Without a mark the record falls back to the session watermark and warns, naming the mark command. Every shipped skill that records a run now marks at its first step instead of noting the time.
