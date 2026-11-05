---
"@n-dx/graview": patch
"@n-dx/graview-face": patch
---

`ndx graview check` holds the emitted snapshot to the declaration, not only the declaration: every record's kind, fields, enum values, number ranges and steps, required fields, Graview's length caps on strings, texts and lists, and its rule against `null`, and every edge's relation, target kind and cardinality. `emit` warns about a record that does not fit and `check` fails on it, naming the record, instead of the misfit surfacing when the face loads. Runs and commits that name a v1 feature or epic the migration turned into a capability, constraint or area now fit (`ranFor`, `landedFor`); a `blockedBy` that names a product node is left out with a warning, since rex requires it to name a change or task. A zone's entry points are capped at Graview's 200.
