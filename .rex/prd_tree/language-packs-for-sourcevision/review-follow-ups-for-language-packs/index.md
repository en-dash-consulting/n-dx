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
lastModified: "2026-10-16T01:45:57.146Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [An imports-only re-run keeps Python in analysedLanguages after the Python pack is gone](./an-imports-only-re-run-keeps-python-in.md) | completed |
| [Consolidate the duplicate go.mod parser (rex parseGoMod and sourcevision go-build)](./consolidate-the-duplicate-go-mod.md) | pending |
| [DRF router.register calls on a router imported from another file are not counted in the Django notice](./drf-router-register-calls-on-a-router.md) | completed |
| [Go and SQL pack grammar versions are not tied to the build pin](./go-and-sql-pack-grammar-versions-are.md) | pending |
| [Go build reader drops the unlistable-directory notice when no go.mod or go.work is found](./go-build-reader-drops-the-unlistable.md) | pending |
| [Go resolver lets a go.mod versioned replace beat the go.work replace for the same module](./go-resolver-lets-a-go-mod-versioned.md) | pending |
| [Java discovery rejects when a .java or pom.xml file is unreadable](./java-discovery-rejects-when-a-java-or.md) | completed |
| [Java entry_point.main misses an interface's implicitly public static void main](./java-entry-point-main-misses-an.md) | pending |
| [Java entry points are guessed from file names, not detected from public static void main](./java-entry-points-are-guessed-from.md) | completed |
| [Java pack grammar version is not tied to the build pin](./java-pack-grammar-version-is-not-tied.md) | completed |
| [Java packageDeclarationRoots throws when a project subdirectory cannot be listed](./java-packagedeclarationroots-throws.md) | completed |
| [Java resolver misses a type nested in an inherited supertype when used by simple name](./java-resolver-misses-a-type-nested-in.md) | pending |
| [Java resolver misses the type in a method reference qualifier (Type::method)](./java-resolver-misses-the-type-in-a.md) | pending |
| [Maven build model collapses dependencies that differ only by type or classifier](./maven-build-model-collapses.md) | completed |
| [Packed-tarball test reads a stale dist, so a newly registered pack fails the gate](./packed-tarball-test-reads-a-stale-dist.md) | completed |
| [python-clients grades a call certain when a parameter or a non-client local shadows a module-level client](./python-clients-grades-a-call-certain.md) | completed |
| [python-clients grades an import-qualified call certain when a parameter or local shadows the imported module name](./python-clients-grades-an-import.md) | completed |
| [scip-java comparison counts constructor references as references to their type](./scip-java-comparison-counts.md) | completed |
| [Spring Boot's byOwner pairs captures by scanning every owner, quadratic in a large Java file](./spring-boot-s-byowner-pairs-captures.md) | completed |
| [Spring Boot scale test does not scale variable declarations, so the declaration sweep can regress unseen](./spring-boot-scale-test-does-not-scale.md) | completed |
| [Terraform agreement test checks a fixed name list, so a new config filename can drift from isTerraformPath](./terraform-agreement-test-checks-a.md) | pending |
| [The Django query captures every list and tuple, adding seconds to large Python data files in every analyze](./the-django-query-captures-every-list.md) | completed |
| [tree-sitter-go 0.25.0 rejects Go 1.26 new(expr) and generic methods](./tree-sitter-go-0-25-0-rejects-go-1-26.md) | pending |
| [Widen gate G2 to junit-framework and thingsboard](./widen-gate-g2-to-junit-framework-and.md) | completed |
| [An imported router or app name rebound locally to a non-router is still followed through its import](./an-imported-router-or-app-name-rebound.md) | pending |
