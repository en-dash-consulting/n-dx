---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Hench's PRD commits stage the files the save actually touched, not the whole tree

Staging `.rex/prd_tree/` wholesale once swept a 1,378-file in-flight rename
into a "task completed" commit. The serializer always knew exactly which files
each save wrote and deleted; that list now crosses the package boundary.

- `@n-dx/rex` — every folder-tree save records the repository-relative paths
  it wrote and deleted (`SerializeResult.writtenPaths`/`deletedPaths`; files
  skipped as unchanged are not listed, and a removed directory is reported as
  the files inside it). Both local stores accumulate the lists across saves
  and expose them through the new `takeSaveFileReport(store)`, which drains
  the accumulator — a caller that saves several times between commit points
  (`--reset-deferred` saves once per task) gets the union, not the last save.
- `@n-dx/hench` — the completion-metadata commit and the `--reset-deferred`
  commit build their `git add` list and commit pathspec from that report plus
  the `tree-meta.json` sidecar. An operator's unrelated dirty file under
  `.rex/prd_tree/` is no longer staged or committed by either; it stays dirty
  in the working tree for the operator to own. A deleted file is staged only
  when git tracks it, and a written file only while it still exists, so the
  staging loop cannot abort on a missing path. Stores that do not report
  saves keep the previous wholesale staging.
