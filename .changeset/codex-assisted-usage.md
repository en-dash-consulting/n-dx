---
"@n-dx/hench": patch
"@n-dx/core": patch
---

`n-dx hench record` measures Codex assisted-skill usage from cumulative rollout counters and reports unavailable usage explicitly.

Start with `n-dx hench usage mark --task=<id>`. Codex discovery uses `CODEX_THREAD_ID` and `CODEX_HOME`; explicit session and transcript flags support wrappers. Cached input is separated from fresh input, repeated counters are ignored, and nested records exclude previously attributed spans. Claude message accounting remains supported.

Action needed: use marks instead of `--since` for Codex rollouts. Missing counters, unsupported formats, and counter resets preserve the boundary for recovery and report unavailable diagnostics. Partial transcripts report partial diagnostics.

Soft freeze: additive Codex transcript discovery and persisted diagnostics; existing Claude commands and record fields remain available.
