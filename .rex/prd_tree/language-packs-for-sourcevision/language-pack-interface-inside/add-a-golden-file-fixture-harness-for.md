---
id: "05774700-76ac-4624-b20e-f121ee233676"
level: "task"
title: "Add a golden-file fixture harness for language packs"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "tests"
blockedBy:
  - "6b72bf55-a1d6-4f7c-b6db-812c74e0f120"
source: "roadmap"
acceptanceCriteria:
  - "The harness runs every built-in pack against its fixtures and fails on any difference from the committed goldens"
  - "Goldens are rewritten only by an explicit update command"
  - "Existing sourcevision evals and non-Java fixtures produce unchanged output"
description: "Add a harness under packages/sourcevision/tests/ that, for each built-in pack, runs the pack over its fixture directory and compares the result (captures, and later resolved edges) with committed golden JSON. Provide an explicit update mode that rewrites goldens, never run by default. Confirm in this task that the existing sourcevision evals and the TypeScript, Go, Swift and Python fixtures produce unchanged analysis output with the pack loader in place."
lastModified: "2026-10-07T23:55:03.396Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
