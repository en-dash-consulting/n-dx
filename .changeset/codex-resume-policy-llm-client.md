---
"@n-dx/llm-client": patch
---

A resumed `codex exec` re-applies the sandbox and approval policy. `compileCodexPolicyFlags(policy, { resume: true })` now emits `-c sandbox_mode="<mode>"` and `-c approval_policy="<value>"` before the shell-environment overrides (never `--sandbox`, which `exec resume` rejects), and the Codex session driver sends them on resume through the new optional `CodexTurnFlags.resumePolicyFlags`. Also additive: `CodexTurnFlags.configFlags` (flags placed right after `exec` / `exec resume` on every turn), `CodexTurnFlags.hiddenEnv` and `codexShellEnvFlags(extraHidden)` (more names blanked in the agent's commands), and `VendorSessionOptions.extraEnv` (named variables added to the resolved child environment).
