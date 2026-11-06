---
"@n-dx/llm-client": patch
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

A TypeSafe key held behind a helper command no longer reads as available before the helper has run. `ndx status` shows `jev: unverified (helper, not run; …)` and rex `get_capabilities` reports `jev: { available: null, source: "helper" }`, and neither runs the helper. `manifest.lastAnalysis.jev` records what the run's own helper call gave: `available: false` when it failed, `null` when the run never called it. Manifests written before this still validate.
