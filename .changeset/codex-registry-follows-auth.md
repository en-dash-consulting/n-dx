---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

The default provider registry picks codex's API or CLI from `llm.codex.auth`, not from whether a key resolves. A codex key held only in the credential store with auth unset, or any key under `auth cli`, now gives the codex CLI instead of throwing, and no stored helper runs to decide. Google auth-mode detection goes through the same decision.
