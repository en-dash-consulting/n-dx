---
"@n-dx/llm-client": patch
---

Price a dated model snapshot at its base model

Vendors ship ids like `claude-haiku-4-5-20251001` while the price table is keyed
on `claude-haiku-4-5`, so the lookup missed and fell back — and the fallback is
`claude-sonnet-5`, a real catalogue entry at roughly three times haiku's input
rate. Every haiku call was therefore priced at sonnet's rates, and the figure
looked measured rather than wrong.

`resolveModelPricing` now also tries the id with a trailing eight-digit date
removed. Only pricing is affected; model *selection* keeps the id it was given,
and a version suffix that is not a date (`jev-1.13.0`) stays unknown rather than
being trimmed into something that happens to match.
