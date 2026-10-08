---
"@n-dx/rex": patch
---

`computeLandings` reports a change that is neither completed nor applied as not landed ("change still open"), so `resolveShippedIn` gives it no release; a change with one task merged and tagged and another unmerged no longer reads as shipped. It also resolves the main ref, checks for a shallow clone and loads the trailer and landing caches once per call instead of once per change. `core/change-landing.ts` joins the v2 modules in the isolation test.
