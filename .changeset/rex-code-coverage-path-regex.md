---
"@n-dx/rex": patch
---

`crossReferenceChanges` no longer takes quadratic time reading file paths out of a PRD item's description or acceptance criteria that contain a long run of `-` or `a/`. A path now has to start at a token boundary, so three matches the old pattern found in the middle of a token are gone: `foo.bar/baz.ts` no longer yields `bar/baz.ts`, `https://github.com/org/repo.git` no longer yields `com/org/repo.git`, and `v1.2/foo.ts` no longer yields `2/foo.ts`. A path that starts a token is read as before, with or without a leading `./`, `../` or `/` (`../lib/x.ts` still gives `lib/x.ts`), and a `.`-led directory is now read whole: `.github/workflows/ci.yml` gives itself where it used to give `github/workflows/ci.yml`. The changed files passed in are reported back as given, as before.
