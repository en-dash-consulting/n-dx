---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`n-dx work` binds Codex executor MCP tools to the assigned worktree and refuses unverified registrations before execution or continuation.

Action needed: Start Codex tasks with `n-dx work` so the launcher can provide the required binding. Use a Codex CLI supporting `app-server config/read --strict-config`; repair configuration named in a refusal before retrying.

Fresh, resumed, forked and retried executors revalidate the per-run binding and native effective configuration. Unrelated MCP registrations and app tools are disabled for the invocation. Existing login, model/provider pins and organizational configuration remain in place; no shared auth or configuration file is rewritten. Claude pinning is unchanged. Reviewer isolation is a separate follow-up.
