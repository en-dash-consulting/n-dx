---
"@n-dx/core": patch
---

`ndx config --test-connection` tests the Claude key the API provider would send: under `llm.claude.auth api` that includes a key held in the credential store. Under `cli` (or `auto` with a store-only key) it says the key is not used and does not test it. The key is never printed.
