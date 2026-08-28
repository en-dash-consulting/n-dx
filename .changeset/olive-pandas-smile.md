---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Show cache tokens instead of hiding them behind the fresh-input figure. A run whose reviewer resumed the work session reported `tokens_in: 319` against a real input of ~15.29M, because the summary printed only the `input` field and dropped `cacheCreationInput`/`cacheReadInput` — which made `--review` look free, the opposite of what charging the review to the run was for.

The hench run summary now breaks the four fields out with a total, `hench record` reports its transcript total split into fresh input, cache write, cache read and output, and `ndx usage` carries cache tokens through its aggregation and display. Cache figures stay out of the input total everywhere: they bill at different rates from fresh input, so folding them in would trade an understated token count for an overstated dollar figure. The `ndx usage` cost line now says what it excludes.
