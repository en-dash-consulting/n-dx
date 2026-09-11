---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Add a narrative PRD rendering: `ndx prd export --format=narrative`.

The PRD can now be written out as prose Markdown for a stakeholder rather than
as a transport bundle. Epics become sections with a stated goal and a
rationale, features become described capabilities, and acceptance criteria
become readable sentences under a "How we'll know it's done" heading.
Dependencies read as sequencing prose — "This follows on from …" — instead of
`blockedBy` id lists. The default format is unchanged: `rex export --out=…`
still writes the JSON bundle.

No internal vocabulary reaches the page. Item ids, folder slugs, and the raw
status and priority values are all omitted by construction: every status and
priority is mapped to a phrase chosen to be disjoint from the enum literal it
replaces (`in_progress` reads as "Under way now", `high` as "Should-have"), so
a single regex sweep for the literals is a real proof rather than a spot check.
A uuid pasted into a description is resolved to the title it names — or
dropped, along with the parentheses it leaves empty, when the title is already
in the sentence or resolves to nothing.

`--item=<id-or-slug>` narrows the document to one subtree, so a single
initiative can be handed over without the rest of the PRD. It resolves an item
id, an exact title, a folder path, or a directory name copied out of
`.rex/prd_tree/` — including the `-{id6}` suffix, which is often the only part
of a directory name that still matches after a slug-rule change. An ambiguous
reference lists the candidates instead of guessing, and a valueless `--item` is
an error rather than a silent whole-PRD render.

Finished and deleted work is excluded by default. `--include-completed`
restores finished items for a retrospective-style document; deleted items stay
out regardless. A finished container that still holds unfinished children is
kept as a section — heading and goal only, with no state or criteria — so its
children do not lose the context they sit in.

Narrative output is deliberately one-way and is documented as such in the
command help, the READMEs, and the PRD-invariant carve-out. The JSON bundle
remains the only round-trip surface; nothing parses a narrative document back.
