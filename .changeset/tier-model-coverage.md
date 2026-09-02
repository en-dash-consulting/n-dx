---
"@n-dx/llm-client": patch
---

Guard the tier catalog against drifting out of the cost and context-window
tables.

Bumping a tier constant to a newer model is an edit this repository has already
made twice — `claude-opus-4-7` → `claude-opus-5`, and `gpt-5.5` →
`gpt-5.6-terra`. Nothing required the matching `MODEL_COSTS` and
`MODEL_CONTEXT_WINDOWS` entries to be added alongside, and nothing failed when
they were missing.

The consequence would have been quiet. `budgetPreflight` falls back to a 128K
window for an unlisted model, so a 200K-token prompt bound for a 1M-context
model is reported as not fitting and rejected as too large, while
`estimatedCostUsd` becomes undefined and cost estimation stops without saying
so — all with a green suite.

A new test iterates every tier the catalog can resolve to and asserts both
tables cover it, skipping the local vendor's deliberately empty entries.
`GOOGLE_MODELS` is folded into the same rule: the previous coverage assertion
reached the google tiers and nothing else, which is exactly the asymmetry that
let claude and codex drift unguarded. The two tables are also checked against
each other, since a model priced but unsized breaks a different half of
preflight.

No production behaviour changes. The runtime fallbacks are deliberately left
alone: `llm.tiers.<vendor>.<tier>` lets a project point a tier at any model id,
including one this catalog has never heard of, so those must keep working. It
is the built-in catalog that needs enforcing, and only a test can enforce that.
