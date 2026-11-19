---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

`n-dx work` and Codex completions refuse native environment allowlists that would remove their private temporary directories before model work starts.

Action needed: If `shell_environment_policy.include_only` is nonempty, retain `TMPDIR`, `TMP` and `TEMP` explicitly alongside its existing entries. Preserve other exclusions. The selected Codex CLI must support strict `app-server config/read`; update the CLI or `llm.codex.cli_path` if that check is unavailable.

The check reads effective native configuration without changing filters, credentials, network permissions or writable roots. Fresh, resumed and forked execution and review calls use the same check.
