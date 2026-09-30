---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Fix the branch guard, `rex tree-diff` and SourceVision's PR markdown in the cases the 0.8.0 B2 review found.

- A stale `origin/HEAD` (one that still names a pruned branch, such as `origin/master` after a rename) is no longer trusted. The branch guard and a bare `rex tree-diff` check the ref exists and otherwise fall back to `main`/`master`, so a user on `main` is no longer refused on their own default branch.
- `rex tree-diff` no longer runs the repository's git hooks when it extracts a tree at a ref, so a failing or slow `post-checkout` hook can't break it.
- When the baseline ref predates the PRD tree, `rex tree-diff`'s text output now says so instead of listing every item as added.
- `sv pr-markdown` warns when either side of the diff has no PRD tree, instead of rendering an empty or whole-project Completed Work section. It no longer forces a local `main` as the base: without an explicit base branch it uses tree-diff's default (`origin/HEAD`, then `main`/`master`) and reports the base tree-diff actually used.
- hench's slug-migration offer and the dashboard's migration route no longer bypass the branch guard. On a feature branch they show rex's refusal, naming the branch.
- `rex ready --item` without a value, including the space-separated `--item <id>`, now refuses and names `--item=<id>`, as `rex log` and `rex export` already do.
