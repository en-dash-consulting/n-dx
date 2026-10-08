---
id: "9ad52cf9-3451-48de-b65e-7b9dfd98411b"
level: "feature"
title: "Language pack interface inside sourcevision"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
blockedBy:
  - "389bb1b2-37c5-47e0-b807-44363f3a48cc"
source: "roadmap"
acceptanceCriteria:
  - "A LanguagePack type and a loader for built-in packs exist under packages/sourcevision/src/language/"
  - "A tree-sitter runner loads a grammar lazily once per process, runs named query files and returns captures, and frees every tree it creates"
  - "A fixture harness compares a pack's output on fixture inputs with committed golden files"
  - "sourcevision analysis output for the existing TypeScript, Go, Swift and Python fixtures and the sourcevision evals is unchanged"
  - "Architecture policy and domain-isolation tests pass unchanged"
description: "Milestone L1. Define the internal language-pack contract, a tree-sitter runner and a fixture harness, all inside packages/sourcevision/src/language/. A pack bundles: the existing LanguageConfig (unchanged), a grammar locator, query files, an optional resolver, optional build-file readers, and a provenance record per rule (versions verified against, date verified, source URL). Framework packs and SCIP ingest come in later phases; leave room for them in the type but do not implement them.\n\nNo new package and no change to the architecture policy tests: extracting @n-dx/lang-kit waits until roadmap PR 24 merges. No public plugin API and no loading of packs from outside sourcevision.\n\nPhase 1 · one PR · starts only if the runner spike recommends go."
lastModified: "2026-10-07T23:54:27.893Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a golden-file fixture harness for language packs](./add-a-golden-file-fixture-harness-for.md) | completed |
| [Add a tree-sitter runner that executes pack queries](./add-a-tree-sitter-runner-that-executes.md) | completed |
| [CI never builds the Java grammar, so every grammar-dependent runner and grammar test skips there and the runner's acceptance criteria are unverified in CI](./ci-never-builds-the-java-grammar-so.md) | pending |
| [Define the language pack type and built-in pack loader](./define-the-language-pack-type-and.md) | completed |
| [Language-pack fixtures and goldens are not pinned to LF, so a Windows CRLF checkout fails the golden comparison](./language-pack-fixtures-and-goldens-are.md) | pending |
| [Published sourcevision has no grammars, so every language pack degrades to inventory-only and the notice points at an unshipped script](./published-sourcevision-has-no-grammars.md) | pending |
