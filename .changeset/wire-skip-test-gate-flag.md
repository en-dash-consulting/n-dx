---
"@n-dx/hench": patch
---

Test gate fixes for local/API-provider runs:

- Wire up the documented `--skip-test-gate` flag on `hench run` (and therefore `ndx work`). It was referenced in gate error messages but never parsed; the only control was the persistent `hench.skipFullTestGate` config field. The flag now applies per-invocation.
- Honor `hench.autonomous` config in the API loop (vendor=local/google), not just the CLI loop — previously a local-model run aborted on test gate failure even with `autonomous: true` set in `.n-dx.json`.
- The autonomous "context" gate action now completes the gate instead of re-running the full suite to the 5-attempt cap and failing the run anyway.
- A test gate that resolves on the fifth attempt (pass/skip/context) is no longer marked as "max retry attempts exceeded".
- A gate skipped via flag/config now prints "Test Gate: Skipped" instead of silently not running.
