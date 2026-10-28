---
"@n-dx/rex": patch
---

Applying a change that retires one member of a pre-existing `dependsOn` cycle no longer fails with "the result breaks depends-on-acyclic" when the rest of the knot stays cyclic: a cycle whose members were all in one cycle before the apply is the same knot, shrunk or split, not a new one.
