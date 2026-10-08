---
"@n-dx/rex": patch
---

Add `rex.applyOn` (`core/apply-policy.ts`), read from `.n-dx.json`: `complete` (default) applies a change when it completes, `review` waits for a steward's explicit apply, and `release` applies at release stamping. A steward's apply runs under every mode; an invalid value falls back to `complete` with a warning. `changesAwaitingApply` lists completed but unapplied changes, which stay open, so their capabilities keep reading changing. Not wired into the store, CLI or MCP yet.
