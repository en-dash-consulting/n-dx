---
"@n-dx/llm-client": patch
---

Add `hench-override` to the vendor/model header's model-source union, and
export the union as `ModelSource`.

The header could describe a model as coming from a CLI flag, an `llm.*` field
or the vendor default. `ndx work` now also resolves an agent-only override
from `hench.models.<vendor>`, which is none of those three — reporting it as
`configured` would have pointed operators at an `llm.*` key that lost.

An explicitly pinned model now suppresses the tier label whichever rung pinned
it: a `hench-override` model was not chosen by the tier table, so annotating it
with a tier would misreport how it was selected. This already applied to
`cli-override` and is unchanged for every other source.

`ModelSource` is exported so callers can type their own resolution result
against the header's union rather than restating the string literals.
