---
"@n-dx/rex": patch
---

Record the folder tree's schema version, so a document reports what wrote it.

The tree load path hardcoded the running `SCHEMA_VERSION`, and `tree-meta.json`
held only the title. A document therefore reported whichever rex read it rather
than whichever wrote it, which defeats forward compatibility at one remove: the
document schema is a `.passthrough()` and `isCompatibleSchema` admits newer
minors, so a tree written by a future `rex/v1.1` loads here intact — unrecognised
fields included — while claiming to be `rex/v1`. Exporting it produced a bundle
labelled `rex/v1`, and `parseBundle`'s minor gate then compared equal minors and
admitted those fields into another tree unvalidated. That is the hole
`buildBundle`'s `doc.schema` stamp was meant to close, reached by a different
route; this is what makes `doc.schema` worth stamping.

`tree-meta.json` now carries `schema` alongside `title`, and both store adapters
read it back. A tree written before the marker existed keeps loading — an absent
or non-string marker falls back to the running version rather than being treated
as corrupt.

A marker that *is* a string is returned verbatim, including one this rex cannot
read. The compatibility checks downstream are what should refuse `rex/v2`, and
they can only do that if the value reaches them.

The four writers of this file use three different mechanisms, for durability
reasons that still hold, so only the *shape* is consolidated — in a new
`store/tree-meta.ts` — which is enough to stop the schema field quietly going
missing from one of them.
