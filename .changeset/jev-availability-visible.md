---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Jev availability is visible: `ndx status` prints `jev: available (env|file|helper)` or `jev: unavailable`, rex `get_capabilities` and the sourcevision manifest's `lastAnalysis` carry `jev: {available, source}`, never the key. `llm.typesafe.required: true` warns once per process when a Jev-routed call falls back to a text model, and `ndx config credentials.typesafe --test` makes one request and reports ok, rejected or unreachable with the key's fingerprint.
