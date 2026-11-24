---
"@n-dx/llm-client": patch
---

`n-dx` explicitly sets Codex workspace network access and writable roots instead of inheriting broader grants from native configuration.

Action needed: use a Codex CLI supporting `--strict-config`. Workspace-write policies must include `.`; use read-only mode when project-root writes are unwanted. Temporary directories are no longer implicitly writable.

Fresh, resumed and forked workspace-write turns carry the same overrides and retain shell credential masking. This does not establish command allowlists or read-path confinement.
