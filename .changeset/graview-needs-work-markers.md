---
"@n-dx/graview": patch
"@n-dx/graview-face": patch
---

`ndx graview` now marks the zones the Analysis page recommends working on with a `!`, and zones it only flags for attention with a separate, non-`!` treatment.

Every zone in the emitted snapshot carries `needsWork` and `highlighted`, plus a `recommendation` naming the first recommended step for a zone that needs work. The needs-work set is the zones named by the first five next steps sourcevision derives from the analysis's findings: the same list the Analysis page's Next steps tile shows. A step scoped to the whole project marks no zone. A zone is highlighted when it is not recommended but the Analysis page counts it among the zones needing attention (cohesion under 40% or coupling over 50%).

The declaration draws a `!` badge on a needs-work zone's card, row and page, a "needs attention" badge on a highlighted one, and lists the needs-work zones on the home. The product face puts a filled `!` before the zone's name on every row and card and a hollow ring on a highlighted one, and its zone page names the recommendation.
