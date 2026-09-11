---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Scope a PRD bundle to one item: `rex export --item=<id-or-slug> --out=<path.json>`
(also `ndx prd export --item=…`).

A single epic or feature can now be carried between machines without exporting
the whole PRD. The scope is a closure rather than a filter, because a filtered
subtree is not importable:

- the requested item arrives with **every descendant** beneath it, so the
  fragment is a working subtree rather than a childless stub;
- it arrives with the **transitive `blockedBy` closure**, so a task blocked by
  an item in a different epic brings that item along. Keeping the edge without
  the target would import a dangling dependency; dropping the edge would lose
  sequencing information;
- it arrives with the **ancestor containers** of everything selected, so import
  reconstructs the subtree at its original depth instead of re-parenting it to
  the root. That applies to items the closure itself pulled in, so a blocker
  from another epic brings its own chain of containers.

Blockers are carried without their own descendants — a blocker is needed as a
dependency target, not as a body of work, and expanding it downward would make
a scoped export unbounded in practice.

The export summary counts the requested subtree and the closure's contribution
separately ("2 requested items … closure pulled in 1 blocking item and 3
ancestor containers"), because a closure can reach well past what was asked
for and a scoped export that quietly grows to half the PRD should say so.
`--format=json` reports the same breakdown under a `scope` key.

Every `blockedBy` id in a scoped bundle resolves to an item in the same bundle.
An edge whose target is missing from the source PRD — already broken before the
export — is dropped rather than carried, and reported with the item that held
it.

`--item` resolves through the same resolver the narrative rendering uses, so a
uuid and a folder slug name the same item and one flag keeps one meaning. An
unknown or ambiguous reference fails before anything is written, so a mistyped
slug never leaves a whole-PRD bundle named after the item it meant to scope to.
