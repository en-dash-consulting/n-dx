---
"@n-dx/web": patch
---

The dashboard footer reports api-key auth from the same decision as the vendor cards, so a key held only in the credential store counts under `llm.claude.auth api`. The init wizard stores a Google key with `ndx config credentials.google --stdin` instead of putting it on the command line.
