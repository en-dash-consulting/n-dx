---
"@n-dx/hench": patch
---

Hench's completion commit no longer aborts when a PRD staging candidate is gitignored in the project. Candidates are now filtered through `git check-ignore` and skipped rather than passed to `git add`, which previously errored and left the whole completion commit unstaged.
