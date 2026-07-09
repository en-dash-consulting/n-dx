---
"@n-dx/llm-client": minor
---

When running ndx config llm.vendor claude if the auth is outdated, a vague error message would show. Now the error message is more explicit and users can run "ndx auth" to troubleshoot that their auth for the configured llm is up to date
