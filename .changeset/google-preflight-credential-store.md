---
"@n-dx/core": patch
---

The Google auth preflight (`ndx config llm.vendor google`, `ndx auth`) finds a key held in the credential store, after `llm.google.api_key` and the exported variable, so a key stored with `ndx config credentials.google` no longer fails with `NDX_GOOGLE_PREFLIGHT_NO_KEY`.
