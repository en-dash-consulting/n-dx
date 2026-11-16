---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`n-dx work` supports warm-parent forks with capability-gated Codex binaries and falls back to cold sessions when the selected binary lacks support.

Action needed: To retain per-task cold starts on supported Codex versions, set `hench.sessionStrategy` to `cold`.

Each task forks the orientation parent, reapplies sandbox, approvals, model and credential hiding, and must report a distinct child session ID. Parent reuse checks checkout, execution policy, binary version and credential/config identity. Opaque keychain identity uses cold starts. Custom-provider fork requests fall back to cold. Batch and explicit cold strategies retain their behavior.

The initial conservative version floor is Codex CLI 0.167, with an additional command-surface probe.
