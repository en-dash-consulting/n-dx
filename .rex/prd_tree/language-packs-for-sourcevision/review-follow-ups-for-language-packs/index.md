---
id: "9307a55e-b3fd-4c5f-afc7-02a364765c2b"
level: "feature"
title: "Review follow-ups for language packs"
status: "pending"
priority: "low"
tags:
  - "language-packs"
  - "review-follow-ups"
source: "review"
acceptanceCriteria: []
description: "Low-priority findings from the adversarial reviews of the language-pack PRs. None of them blocks a phase gate; they are kept here so they do not hold a PR's feature open. Pick them up when a later PR touches the same code, or as a batch before the stacked PR is opened."
lastModified: "2026-10-08T02:01:58.603Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Consolidate the duplicate go.mod parser (rex parseGoMod and sourcevision go-build)](./consolidate-the-duplicate-go-mod.md) | pending |
| [Go build reader drops the unlistable-directory notice when no go.mod or go.work is found](./go-build-reader-drops-the-unlistable.md) | pending |
| [Go calls query leaves string arguments of unnamed calls without an owning argument list](./go-calls-query-leaves-string-arguments.md) | pending |
| [Go resolver lets a go.mod versioned replace beat the go.work replace for the same module](./go-resolver-lets-a-go-mod-versioned.md) | pending |
| [Java entry points are guessed from file names, not detected from public static void main](./java-entry-points-are-guessed-from.md) | pending |
| [Java pack grammar version is not tied to the build pin](./java-pack-grammar-version-is-not-tied.md) | pending |
| [Java packageDeclarationRoots throws when a project subdirectory cannot be listed](./java-packagedeclarationroots-throws.md) | pending |
| [Maven build model collapses dependencies that differ only by type or classifier](./maven-build-model-collapses.md) | completed |
| [Packed-tarball test reads a stale dist, so a newly registered pack fails the gate](./packed-tarball-test-reads-a-stale-dist.md) | completed |
| [scip-java comparison ignores constructor references and covers only PetClinic](./scip-java-comparison-ignores.md) | pending |
| [tree-sitter-go 0.25.0 rejects Go 1.26 new(expr) and generic methods](./tree-sitter-go-0-25-0-rejects-go-1-26.md) | pending |
