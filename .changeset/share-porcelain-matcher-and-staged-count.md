---
"@n-dx/hench": patch
---

Give the pre-run and post-run git gates one porcelain path matcher, and collapse
two duplicated helpers.

The uncommitted-work gate had its own `normalize` plus a project-path matcher
that re-implemented `isHenchRuntimeArtifact` line for line: same normalisation,
same "trailing slash matches the directory and everything beneath it" rule, same
decision to apply the repo prefix to the pattern rather than strip it from the
path. Two copies of one rule across the two gates that judge the same
`git status --porcelain` line, so fixing either one could leave them disagreeing
about whether a run's own output counted as operator work. `matchesProjectPath`
now lives in `store/artifacts.ts` and both call it — `isHenchRuntimeArtifact` is
it, applied to the runtime-artifact list.

`commitPrdTreeIfStaged` inlined a staged-file count that `countStagedFiles`, a
few hundred lines above it in the same file, already did — differing only in
carrying a `.rex/` pathspec. `countStagedFiles` now takes an optional pathspec.

Livelock detection kept three things to remember it had already fired: a
per-signature `reported` set, a `firstDetection` slot and the `record` return
value. Firing is terminal — the API loop breaks on the first detection and the
CLI loop kills the child and gates further records on `!result.livelock` — so no
caller could ever observe the second and third. One `detection` field replaces
them. The call that gets named is unchanged for every real caller, since they
all stop at the first signature to reach the threshold.

No behaviour change.
