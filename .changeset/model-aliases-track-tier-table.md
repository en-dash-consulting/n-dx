---
"@n-dx/llm-client": patch
---

Derive the `haiku` / `sonnet` / `opus` model aliases from `TIER_MODELS.claude` instead of hardcoding them, so an alias can no longer disagree with the tier it names. The heavy tier had previously moved to `claude-opus-5` while the `opus` alias stayed on `claude-opus-4-8`, meaning `llm.claude.model: "opus"` ran the older Opus; both IDs are valid and priced identically, so nothing surfaced the gap. `fable` remains a pinned literal — no tier points at it — and a test now fails on any other undeclared literal alias.
