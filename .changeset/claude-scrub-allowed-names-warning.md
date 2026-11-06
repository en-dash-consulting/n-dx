---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

When the Claude subprocess scrub is on, a credential-shaped variable that `hench.guard.env.allow` lets through (such as `DB_PASSWORD`) is now named in the run log, value never shown, because the agent's own commands will not see it while hench's test gate still does.
