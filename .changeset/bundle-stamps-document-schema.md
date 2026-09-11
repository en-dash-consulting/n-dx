---
"@n-dx/rex": patch
---

Label a PRD bundle with the document's schema version, not the exporter's.

`buildBundle` wrote `schema: SCHEMA_VERSION` — its own running constant.
`isCompatibleSchema` deliberately admits newer minors and the document schema is
a `.passthrough()`, so a document written by a future rex loads here intact,
unrecognised fields and all. Exporting it relabelled it downward, and
`parseBundle`'s gate then compared `0 > 0` and never fired: those fields reached
the tree unvalidated, which is precisely what the gate exists to prevent.

The bundle now carries `doc.schema`, falling back to the running version when
the document has no marker — a bundle labelled `undefined` is one no version
gate can read.

Exposure was narrower than it looks, and remains so: the folder-tree load path
hardcodes the running version and the tree persists no marker of its own, so
only the legacy `prd.md` / `prd.json` backends preserve a file's schema string
today. Closing that gap is tracked separately.
