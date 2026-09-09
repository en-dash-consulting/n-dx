---
"@n-dx/web": patch
"@n-dx/rex": patch
---

Attribute SourceVision Ask spend in the token-usage rollup

Each ask spent real tokens from an interactive surface with no accounting path: the counts were returned in the HTTP response and then forgotten, which made the dashboard's own LLM spend the one spend invisible in the very view that reports spend.

Every ask now appends a line to `.sourcevision/ask-usage.jsonl` recording vendor, model, tier, outcome, duration and all four token counts — including cache creation and cache read, reported rather than folded into input, consistent with the existing hench and rex cache reporting. Failed and timed-out asks are recorded too, so an attempt is visible rather than assumed free; and because the ask timeout does not cancel the provider call, a call that answers after the endpoint gave up books its real tokens flagged `late`.

Both rollups read the ledger: the dashboard (`/api/token/*`) and `ndx usage`. Spend lands in the existing `sv` package bucket under `command: "ask"` — an ask is SourceVision spend (task class `sourcevision.ask`, grounded in `.sourcevision/`) and is not task-scoped, so it is not attributed to a PRD item. The command name is what separates it from hench's `run` in the per-command breakdown. The aggregation cache fingerprint now includes the ledger, so a fresh ask invalidates the cached total instead of serving the pre-ask figure.
