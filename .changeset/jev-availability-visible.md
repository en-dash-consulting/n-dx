---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Jev availability is visible: `ndx status` prints `jev: available (env|file|helper)` or `jev: unavailable`, rex `get_capabilities` and the sourcevision manifest's `lastAnalysis` carry `jev: {available, source}`, never the key. `llm.typesafe.required: true` warns once per process when a Jev-routed call falls back to a text model, and `ndx config credentials.typesafe --test` makes one request and reports ok, rejected or unreachable with the key's fingerprint.

Soft freeze: `llm.typesafe.required` and `--test` are a new `ndx config` key and flag, and `ndx status` gains a `jev` line. rex `get_capabilities` gains an additive `jev` field and the sourcevision manifest's `lastAnalysis` an optional `jev` field, so MCP output grows but no field changes or disappears.
