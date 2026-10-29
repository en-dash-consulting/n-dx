---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Bound vendor CLI sessions. The Claude CLI now receives `--max-turns` from the resolved turn cap; Codex, which has no turn flag, is capped by counting agent steps from its event stream. A new `guard.sessionTimeout` (default two hours, 0 disables) stops a session's process tree and ends the run with status `timeout`. New `hench.maxCostUsdPerRun` and `hench.maxCostUsdPerDay` caps (off by default) are checked before every vendor spawn against the run ledger, and a run that has reached one stops with `budget_exceeded`; a task's saved `run` block cannot raise them. SIGINT and SIGTERM now stop the vendor CLI in flight and record the run as cancelled, and a second signal terminates it before exiting. Claude tool results are recorded on the run's tool calls, and API-provider runs keep the guard's audit summary and session counters on the run record.
