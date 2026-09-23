---
"@n-dx/sourcevision": patch
---

fix(sourcevision): lead Next Steps and Problems titles with plain language, not the metric

Generated Next Step titles read metric-first ("Low cohesion (0.2) — files are
loosely related, consider splitting this zone") because the same
`Finding.text` also backs CONTEXT.md and llms.txt, where a number up front is
the point. Read standalone in the dashboard, that reads as jargon before
context — an outside first-use review couldn't tell what the finding meant
without opening a detail panel.

`next-steps.ts`'s title templates now strip a recognized "<Metric label>
(<value>) —" or "<Metric label>:" lead via `plainLanguageLead()` and title on
the plain-language remainder instead; a grouped Next Step states the group's
count before that lead ("2 related findings: ...") rather than appending
"(+N related)" after the raw text. `Finding.text` itself is untouched — it
still becomes `NextStep.description`, unabridged — so CONTEXT.md and
llms.txt keep exactly the same structure and the same underlying text; only
the Next Step / Problems title wording changes. Free-form (AI-authored)
finding text without a recognized metric prefix passes through unchanged.

No change to the findings or next-steps JSON shape.
