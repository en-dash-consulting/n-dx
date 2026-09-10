---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

State the enrichment output contract once instead of four times, and fix the
copy that had already drifted.

Four builders across `enrich-batch.ts` and `enrich-per-zone.ts` each spelled out
the response format for themselves — the severity enumeration, the "respond with
only JSON" instruction, and the later-pass "add only new insights" rule. Written
out four times, they had diverged: `buildSingleZoneLaterPassEnvelope` asked for
`"Respond with ONLY a JSON object:"` where the other three asked for
`"...(no markdown, no explanation)"`, so one enrichment path never forbade
markdown at all.

That drift was survivable rather than harmless — `tryParseJSON` strips fences
before parsing, so a fenced response was recovered — which is precisely why
nothing caught it. It still spent output tokens on a path that had asked for
none, on a prompt that runs once per zone.

The contract now lives in `prompt-envelope.ts` as `JSON_OBJECT_ONLY`,
`ONLY_NEW_INSIGHTS`, and `findingsContract(withCategory)`. The category clause is
the one intended difference between batch and per-zone prompts — per-zone is the
minimal fallback path and `classifyFinding` derives a category from the finding
text when the model omits one — so that difference is asserted rather than left
to be rediscovered as drift.

sourcevision drops from 2,332 to 2,194 unique fixed tokens. Per-call is
essentially unchanged: the emitted text is byte-identical for every batch prompt
(the `prompt-text-identity` snapshots pass untouched), and the one deliberate
change adds the missing no-markdown clause to the per-zone later pass.

Also records why `buildReviewerPrompt` lives in `packages/core/`. The
orchestration-tier rule is spawn-only, and it constrains *imports*, not string
composition: `pair-programming.js` imports nothing but Node built-ins and its
core siblings, then hands the prompt to a spawned CLI. Moving it into a package
would force core to import it, which is the thing the rule actually forbids.
