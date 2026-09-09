---
"@n-dx/web": patch
---

Write only the three known fields when applying a PRD refinement.

`applyRefinements` spread the posted `updates` object into `updateInTree`, which
is an `Object.assign`. The route's shape check never looks at `updates`
(`isProposalShape` checks `op`, `id`, `itemId`, and `baseline`), `validateAgainst`
checks only that it is non-empty and that `priority`, if present, is valid, and
the TypeScript type is erased at runtime — so a crafted proposal carrying
`status: "completed"` and `children: []` alongside an honest fingerprint and a
diff declaring a description change applied all of it and reported `applied`.
`validateDocument` inside the transaction does not catch that: a childless
completed epic is schema-valid.

`description`, `acceptanceCriteria`, and `priority` are now picked off `updates`
individually, at the write, where the next person adding a refinement field is
already looking.

The model cannot reach this — `RawRefinementSchema` is non-strict so zod strips
unknown keys, and `buildEdit` constructs `updates` field by field — and
`request-security.ts` blocks cross-site browser mutations, so this is
defence-in-depth rather than a closed exploit path. What made it worth fixing is
that it contradicted the reason the route gives for its own body check being
structural: that field legality is re-established under the lock. For staleness
and mutation legality it is; for field scope it was not. That docblock now says
so and points at where the scope is actually enforced.
