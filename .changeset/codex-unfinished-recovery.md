---
"@n-dx/hench": patch
---

`n-dx work` continues unfinished Codex sessions once and refuses reviewed completion when the reviewer produces no usable report.

Action needed: If review stops without a valid report, fix the reported reviewer problem and rerun the task. Use `--review-optional` only when best-effort review is intended.

Continuation uses the original session only while its execution identity remains valid, reapplies policy, and preserves cancellation and validation gates. Shell ampersands do not trigger recovery.
