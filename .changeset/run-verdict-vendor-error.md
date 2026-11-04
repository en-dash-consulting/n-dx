---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

The run verdict now reads a vendor failure from the run's error as well as from failure events, so `vendor-transient` fires on default config (the event pipeline is off by default). An auth, rate-limit or transient error counts; an auth failure's action is to re-authenticate the vendor CLI and re-run, not to retry later. `no-changes` now needs the agent to have made a tool call, so a run that dies on its first turn from a vendor or CLI error is no longer told to tighten its done-when. `classifyVendorError` classes a CLI "session limit" message as `rate_limit`.
