---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

Raise the local-model request timeout and make it configurable

Local inference on a large model routinely needs more than the previous
hard-coded 5 minutes per request, so a slow turn aborted a run that was
otherwise healthy. The per-request timeout for `llm.vendor = "local"` is now
15 minutes by default, in both the local API provider and the hench
tool-use loop, and is settable per project:

```sh
ndx config llm.local.timeoutMs 1800000
```

The second-model verifier keeps a separate, shorter budget — verification is
best-effort and a hung verifier is skipped rather than allowed to stall the run
— raised from 1 to 2 minutes and overridable via `llm.local.verifier.timeoutMs`.

A non-positive or non-finite configured value falls back to the default instead
of disabling the timeout, so a typo cannot hang a run indefinitely. Both new
keys are registered as numeric config paths, so a value stored as a string is
repaired by `ndx init`.
