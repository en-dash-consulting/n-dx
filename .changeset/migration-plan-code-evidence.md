---
"@n-dx/rex": patch
---

`rex migrate-plan` fills each capability's code evidence from the sourcevision analysis. The spec drafter has always taken a capability-to-code-files map and no caller supplied one, so every capability in a migration plan reported "no code or test evidence" and the spec-drafting prompt was handed an empty list.

`readCapabilityCodeFiles` reads the analysis off disk — rex reads the files, as `analyze/scanners.ts` already does, and never imports sourcevision. Two signals are unioned per item: the non-test files of the zone whose id or name best matches the item's **title**, and the files imported by the tests the item's criteria link to, matched by the drafter's own `linkedTests` so the two agree. Only the title decides a zone, because criteria words describe behaviour and reach zones the capability has nothing to do with. A tie across more than two zones contributes nothing, and the union is ranked by how much of the item each path names and capped at twenty files, since `codeFiles` is quoted verbatim into the drafting prompt.

The map stays plan input: capabilities carry no `codeFiles` field, so the soft-frozen v2 schema is unchanged. With no analysis directory the reader returns an empty map and the plan is byte-identical to one planned before the reader existed.
