---
"@n-dx/web": patch
---

The trust strip's visible line always shows how many PRD items carry saved run settings, even when three config files come first. `GET /api/trust` gains a `prdRunBlocks` count; the Details list still names every source. The strip is capped at a third of the viewport less the top nav and bottom bar, and the restrictions sentence moved under Details so the collapsed line fits two lines.
