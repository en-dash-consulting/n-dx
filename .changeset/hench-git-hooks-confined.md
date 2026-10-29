---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Repository git hooks run again for every commit hench makes — the agent's `git` tool and hench's own lifecycle commits, staging and stashes — as they would for a human commit. They are confined rather than skipped: the `git` tool already runs inside the OS sandbox, so hooks it triggers inherit it; for lifecycle commands, each hook git starts is re-executed inside the sandbox through a generated wrapper (`core.hooksPath`), with read-write access to the project and git directory, read-only access to hench's own state and the operator's local config, and the tool network setting. A hook that needs the network requires `sandbox.network: "allow"`. With the sandbox off or unavailable, hooks run unconfined.
