---
"@n-dx/hench": patch
---

A resumed Codex run (the batch session chain) re-applies the run's sandbox and approval policy with `-c sandbox_mode=` and `-c approval_policy=` overrides, instead of falling back to the user's `~/.codex/config.toml`.
