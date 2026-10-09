---
"@n-dx/llm-client": patch
---

Repository trust now covers `guard.env.allow`. A tracked `.hench/config.json`
(or a `.n-dx.json` hench override) that passes credential-shaped environment
variables through to the agent's processes changes the trust digest and raises
an `env-allow-added` warning in the trust review, instead of taking effect
unseen on an already-trusted checkout. `guard.env.deny` is not collected — it
can only remove variables, so it never widens what the agent can read.
