---
"@n-dx/rex": patch
---

`crossReferenceChanges` no longer takes quadratic time reading file paths out of a PRD item's description or acceptance criteria that contain a long run of `-` or `a/`. A path now has to start at a token boundary, so three matches the old pattern found in the middle of a token are gone: `foo.bar/baz.ts` no longer yields `bar/baz.ts`, `https://github.com/org/repo.git` no longer yields `com/org/repo.git`, and `v1.2/foo.ts` no longer yields `2/foo.ts`. The same rule drops `hidden/x.ts` from `src/.hidden/x.ts` and `up/x.ts` from `../up/x.ts`. Every path that starts a token, with or without a leading `./` or `/`, is read as before.
