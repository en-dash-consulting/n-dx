---
id: "180d3cb3-9373-4a36-8b90-2c1e9f5d375a"
level: "task"
title: "Seed the Java drift corpus and measure the parse rate"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "java"
  - "tests"
blockedBy:
  - "12afe7fd-ec91-424d-9dc1-d932848044e4"
source: "roadmap"
acceptanceCriteria:
  - "The corpus list pins three public repositories by commit SHA"
  - "The script clones to a machine-local cache and reports file counts, clean-parse share and capture counts per repository"
  - "Measured results are in the rex log; gate G1 (98% clean parse) is met, or the failing constructs are listed"
  - "The script is excluded from the default test run"
description: "Add a pinned corpus list (repository URL plus commit SHA) for Java: Spring PetClinic (spring-projects/spring-petclinic), one multi-module Maven repository and one Gradle repository with the Kotlin DSL, all public. Add a script that clones the corpus to a machine-local cache through the sourcevision paths module and reports, per repository, the .java file count, the share parsed without ERROR or MISSING nodes, and capture counts per query.\n\nThe script is not part of the default test run. Run it, append the per-repository numbers to the rex log for this task, and confirm gate G1: at least 98% of .java files parse cleanly. If a repository falls short, list the failing constructs in the log rather than loosening the gate."
lastModified: "2026-10-08T00:04:15.879Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
