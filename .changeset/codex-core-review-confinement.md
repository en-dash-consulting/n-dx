---
"@n-dx/core": patch
---

`n-dx pair-programming` confines its Codex reviewer to read-only access with approvals disabled and credential masking, regardless of broader native sandbox settings.

Action needed: use a Codex CLI supporting `--strict-config`. Reviewer commands cannot write files; configured test commands continue to run separately on the host.
