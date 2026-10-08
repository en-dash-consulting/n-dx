---
id: "797bc357-7641-427e-bc73-b09eb12f1f32"
level: "task"
title: "Measure Java parse throughput on large repositories"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
blockedBy:
  - "4c2738d2-c2e3-4656-b21c-0f281ee81cc5"
source: "roadmap"
acceptanceCriteria:
  - "The benchmark script runs against any local directory and prints files, time, files per second, peak memory and the share of files with ERROR or MISSING nodes"
  - "Results for PetClinic and one large Spring Boot repository, each with its commit SHA, are in the rex log for this task"
  - "The rex log states go or no-go for the runner, with the reason"
  - "The benchmark is excluded from the default test run"
description: "Add a benchmark script under packages/sourcevision/scripts/ that walks every .java file in a directory, parses each with web-tree-sitter and the built Java grammar, and prints file count, total and per-file time, files per second, peak memory, and the share of files whose tree contains ERROR or MISSING nodes. Free each tree after use.\n\nRun it on Spring PetClinic (spring-projects/spring-petclinic) and on at least one large open-source Spring Boot repository, both pinned to a commit SHA, cloned outside the repo. The script is not part of the default test run, because it needs the network and large inputs. Append the numbers, the commit SHAs and a go or no-go recommendation for the runner to the rex log for this task."
lastModified: "2026-10-08T00:04:14.842Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
