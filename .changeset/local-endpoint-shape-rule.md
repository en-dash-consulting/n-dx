---
"@n-dx/llm-client": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

One host and port shape rule for the local LLM endpoint. `@n-dx/llm-client` exports `isPlausibleLlmHost`, `isValidPort` and `describeLocalEndpointProblem`, and the local inference provider refuses a saved `llm.local.host` or `llm.local.port` that fails them before building its URL — a hand-edited `.n-dx.json` used to reach `fetch` unchecked. The dashboard imports the rule instead of carrying a copy, and reports a saved port written as a string as invalid rather than silently probing 1234. `ndx config llm.local.host` (and `llm.local.verifier.host`) refuses a host carrying a path, credentials, a second port or whitespace, and accepts `localhost`, `127.1`, `[::1]` and a LAN name — `127.1` was previously coerced to a number and refused. A parity test holds core's inline copy equal to llm-client's.
