---
"@n-dx/rex": patch
---

Add `draftCapabilitySpecs`, the spec step of the v2 migration plan. For each planned capability it drafts a present-tense statement and EARS-style criteria from the feature and its applied history. A criterion whose words match test file names becomes an automated requirement; a wide tie links nothing. Code evidence from sourcevision is passed in by the caller. A draft leaves `reviewedHash` unset unless the capability is listed as reviewed. Not wired to a command yet.
