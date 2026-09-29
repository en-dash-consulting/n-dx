---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Record the session strategy, hit/miss reason and token-data provenance on every run.

Every run record now carries a `session` field naming which session strategy ran
(`fork` / `batch` / `cold`), whether the cache served it, the named reason it did or
did not, and how old the entry was. `hench show` and the end-of-run summary print it
as one line; the dashboard's run detail gains a Session section. Until now the only
trace of that decision was a terminal line nobody was capturing, so "is batching
actually hitting?" could not be answered from run history.

API-provider runs record the decision too, as `cold` / `api-provider` — that path holds
no session resumable by id, and saying so is not the same as saying nothing, which is
also what a run that died before reaching the decision looks like.

Cache token counts now say where they came from. `tokens.cachedProvenance` and the
per-turn `cacheProvenance` distinguish a vendor that accounted for caching and
reported none from a vendor that never reported it at all — both of which used to
read as a confident `cached: 0`.

Fixes two places where Codex cache data was dropped: the token parsers ignored
Codex's `cached_input_tokens` / `cache_write_input_tokens` field names, and the Codex
JSONL event parser kept only input and output from a turn's `usage`. A Codex turn
reporting 45,472 input with 35,072 cached is now split correctly rather than counted
entirely as uncached input — the total is unchanged, the attribution and the price
are not.

All fields are additive; run records written before this change load unchanged.
