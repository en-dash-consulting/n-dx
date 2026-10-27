---
id: "05774700-76ac-4624-b20e-f121ee233676"
type: "change"
title: "Add a golden-file fixture harness for language packs"
slug: "add-a-golden-file-fixture-harness-for"
intent: "Add a harness under packages/sourcevision/tests/ that, for each built-in pack, runs the pack over its fixture directory and compares the result (captures, and later resolved edges) with committed golden JSON. Provide an explicit update mode that rewrites goldens, never run by default. Confirm in this task that the existing sourcevision evals and the TypeScript, Go, Swift and Python fixtures produce unchanged analysis output with the pack loader in place."
acceptanceCriteria:
  - "The harness runs every built-in pack against its fixtures and fails on any difference from the committed goldens"
  - "Goldens are rewritten only by an explicit update command"
  - "Existing sourcevision evals and non-Java fixtures produce unchanged output"
amends: [{"target":"9ad52cf9-3451-48de-b65e-7b9dfd98411b","delta":"modified","summary":"Add a golden-file fixture harness for language packs","base":"0c9addd6403363d2ad142d067aff6ffb39bab54e8ceddbbe325a87d4188ea773"}]
priority: "medium"
tags:
  - "language-packs"
  - "phase-1"
  - "sourcevision"
  - "tests"
source: "roadmap"
blockedBy:
  - "6b72bf55-a1d6-4f7c-b6db-812c74e0f120"
---
