---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`n-dx work` binds Codex executor MCP tools to the assigned worktree and refuses unverified registrations before execution or continuation.

Action needed: Start Codex tasks with `n-dx work` and select the verified CLI `0.167.0-alpha.3.2` through `llm.codex.cli_path`. Keep runs blocked if their required provider or managed policy is reported unsupported; do not remove organizational restrictions to retry.

Fresh, resumed, forked and retried executors revalidate the per-run binding, native layers and separate requirements response. Execution ignores mutable user/project registrations, including names added after validation, and receives only the admitted configuration and assigned MCP servers. Original login storage and supported model/provider and confinement settings remain in place; no shared auth or configuration file is rewritten.

Nonempty or unknown managed policy, native profiles, hooks and unsupported provider credentials or settings refuse before execution rather than being silently dropped. Claude pinning is unchanged. Reviewer isolation is a separate follow-up.
