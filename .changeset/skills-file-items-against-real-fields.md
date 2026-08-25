---
"@n-dx/core": patch
---

File PRD items against `add_item`'s real fields in every skill that creates them.

`/ndx-plan`, `/ndx-capture`, and `/ndx-reshape` described item content in prose —
"create it with appropriate descriptions, acceptance criteria, and parent
placement" — without naming the parameters those map to. Two things went wrong
as a result. Acceptance criteria landed in `description` prose while the
`acceptanceCriteria` array stayed empty, and that array is what `verify_criteria`
and the dashboard's requirements view read, so the criteria could never be mapped
to tests or checked by a later review: the item looked complete while being
quietly unverifiable. And `level`, which is required with no default, was guessed
per run, so items of the same kind landed at different levels.

Each skill now names the fields it actually needs rather than carrying a copy of
the same table. `/ndx-plan` — which files in bulk and had no coverage at all —
gained the full mapping including `priority` and `source`. `/ndx-capture` already
handled level, parent, and priority through its own steps, so it gained the
`acceptanceCriteria` and `source` guidance it lacked. `/ndx-reshape` creates
containers rather than work items, so it gained explicit `level` and `parentId`
for those, and the criteria rule for the rarer case where a container has a
testable outcome of its own.

A new test, `tests/e2e/skill-item-fields.test.js`, derives its skill list from the
manifest, so a future skill that creates items is covered the moment it is added.
