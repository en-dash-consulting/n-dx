---
"@n-dx/hench": patch
---

Honour repository trust. Until the user accepts a checkout's execution config (`hench trust accept`), runs use the default guard — the repository's `.hench/config.json` can tighten it but not widen it — and `bypassPermissions` is lowered to `acceptEdits`; `ndx work` prints the review once per invocation and each run record carries a `trust` summary. New `hench trust [status|accept|revoke]` command. Guard defaults now come from the shared baseline and block credential files. Child processes the agent starts receive an environment stripped of credential-shaped variables (`guard.env.allow` / `guard.env.deny` adjust it). The git tool refuses `--output`, `--output-directory`, `--exec-path`, `--upload-pack`, `--receive-pack` and `--config-env`, which wrote or executed outside the guarded project.
