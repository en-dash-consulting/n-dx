---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Add `hench.promptCacheTtl` to opt in to Anthropic's 1-hour cache TTL

Both `cache_control` breakpoints in the Anthropic API loop used the
5-minute TTL unconditionally. Anthropic measures the TTL from the start of
the request that wrote or read the entry, so a turn whose tool call runs
long (a slow test gate, for example) leaves the next request outside that
5-minute window: the conversation prefix is re-written at the 1.25x-input
rate instead of read at 0.1x.

`hench.promptCacheTtl` (`"5m"` | `"1h"`, default `"5m"`) lets both
breakpoints move to the 1-hour TTL. It is opt-in: a 1-hour write costs 2x
input rather than 1.25x, so it only pays off when the gap between turns
regularly falls between 5 and 60 minutes. Cost estimates price every write
at 1.25x regardless of TTL — see the caveat above `MODEL_COSTS` in
llm-client's `config.ts` — so enabling `"1h"` under-reports
estimated spend by that difference. `ndx config hench.promptCacheTtl 1h`
persists it to `.hench/config.json`.
