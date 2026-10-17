---
id: "8a558da2-8724-4e8c-8a44-42b0d70b7f5b"
level: "feature"
title: "Stack review fixes: resolvers and build readers (PR 18)"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "review-fixes"
  - "resolvers"
  - "pr-18"
blockedBy:
  - "3c7c3ece-83a5-49ac-9358-2a0c0a1a8a9c"
source: "review"
acceptanceCriteria:
  - "Python and Java externals carry their language namespace"
  - "Java resolution prefers the referencing module and never links main to test"
  - "Go keeps imports of files over 1 MB and records replace-to-skipped-dir imports as external"
  - "Python follows re-exports through __init__.py"
  - "Gradle continuation lines and sqlc JSON arrays are read correctly"
description: "Code fixes from the 2026-10-16 stack review to the language resolvers and build-file readers, including Ryan's two decided external namespaces (python: and java:). Stacked on #822 (PR 17). Brief: workshop language-scaling/pr17-20-review-fixes-brief.md."
lastModified: "2026-10-17T06:54:47.932Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Follow Python re-exports through a package's __init__.py](./follow-python-re-exports-through-a.md) | pending |
| [Give Java externals the java: namespace](./give-java-externals-the-java-namespace.md) | completed |
| [Give Python externals the python: namespace](./give-python-externals-the-python.md) | completed |
| [Java test code in one module still links to another module's test classes](./java-test-code-in-one-module-still.md) | pending |
| [JDK packages outside java/javax/jdk (org.w3c.dom, org.xml.sax, com.sun.*, sun.*) are named java: instead of java:stdlib:](./jdk-packages-outside-java-javax-jdk.md) | pending |
| [Keep imports of Go files over the pack's size cap and of replaced modules in skipped directories](./keep-imports-of-go-files-over-the-pack.md) | in_progress |
| [Prefer the referencing module and source set when a Java name has several declarations](./prefer-the-referencing-module-and.md) | completed |
| [Read Groovy Gradle statements that continue after a trailing comma](./read-groovy-gradle-statements-that.md) | pending |
| [Read sqlc JSON configs with arrays and multi-line lists](./read-sqlc-json-configs-with-arrays-and.md) | pending |
