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
  - "An operator-run script clones the corpus at the pinned SHAs into a machine-local directory outside the repo; nothing clones during an agent run"
  - "The report script reads the corpus directory and prints file counts, clean-parse share and capture counts per repository, or names the missing repositories and the clone command"
  - "Measured results are in the rex log; gate G1 (98% clean parse) is met, or the failing constructs are listed"
  - "Both scripts are excluded from the default test run"
description: "Add a pinned corpus list (repository URL plus commit SHA) for Java: Spring PetClinic (spring-projects/spring-petclinic), one multi-module Maven repository and one Gradle repository with the Kotlin DSL, all public. Add two scripts: one the operator runs to clone the corpus at the pinned SHAs into a machine-local directory outside the repo (default ~/.cache/ndx-java-corpus/, overridable by an environment variable), and one that reads that directory and reports, per repository, the .java file count, the share parsed without ERROR or MISSING nodes, and capture counts per query.\n\nDo not clone or fetch anything during the run: hench's agent session refuses network git commands. The operator clones the corpus before the run. If the corpus directory is missing or incomplete, stop and write to the rex log the exact command the operator must run, rather than failing. PetClinic and thingsboard/thingsboard are already in ~/.cache/ndx-java-corpus/ from the runner benchmark and may be reused if they fit the list.\n\nNeither script is part of the default test run. With the corpus present, run the report, append the per-repository numbers to the rex log for this task, and confirm gate G1: at least 98% of .java files parse cleanly. If a repository falls short, list the failing constructs in the log rather than loosening the gate.\n\nThe operator has already cloned the corpus (shallow, depth 1) into ~/.cache/ndx-java-corpus/. Pin exactly these three:\n- spring-petclinic: https://github.com/spring-projects/spring-petclinic.git @ 500158f732419217507c7656904b8e6aa1bcc0d6 (single module; 50 .java files)\n- thingsboard: https://github.com/thingsboard/thingsboard.git @ 0439df09f31b0e8101b9f0a6be556c087d86818d (multi-module Maven, 110 pom.xml; 6885 .java files)\n- junit-framework: https://github.com/junit-team/junit-framework.git @ 99a00b9bb82723d5aa573942b15618ec3f3ab396 (Gradle Kotlin DSL, 79 .gradle.kts; 1793 .java files)\nThe clone script must reproduce exactly these checkouts for another operator; the report reads the existing directories."
lastModified: "2026-10-08T00:04:15.879Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
