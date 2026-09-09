---
"@n-dx/sourcevision": patch
---

Verify declared injection seams against the call graph in the isometric map.

A seam declared under `sourcevision.isoMap.injectionSeams` was drawn on trust,
so a refactor could leave the declaration behind and the map would keep
asserting a relationship that no longer existed. Where a call graph is available
each declared callback is now looked for among the calls made inside the seam's
target zone. A seam nothing corroborates is drawn in a fainter, sparser pattern,
labelled unverified in its panel, and reported in the page footer naming the
specific callbacks that did not resolve. Seams still resolve unchecked when no
call graph exists — absence of evidence is not rendered as evidence of absence.

Evidence is zone-scoped rather than file-scoped because a file handed a callback
often forwards it rather than calling it, and a call from the injecting side is
not counted at all.

Also: a seam that cannot be placed now names which endpoint no zone owns instead
of reporting a generic failure, and this repository's own declaration — which
pointed at a `register-scheduler.ts` path deleted in an earlier refactor — is
corrected.
