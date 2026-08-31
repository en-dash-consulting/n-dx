---
id: "d9e4fb4a-1cbf-4933-82aa-10f58de1f3db"
level: "task"
title: "Verify declared injection seams against the code"
status: "pending"
priority: "low"
acceptanceCriteria: []
description: "A seam declared under `sourcevision.isoMap.injectionSeams` is drawn on the map on trust — nothing checks the named callbacks still exist, or that the injection site still injects them. A refactor can leave the declaration behind, and the map will keep asserting a relationship that no longer exists, which is worse than showing nothing.\n\nThe call graph is the obvious cross-check: a declared seam whose callbacks appear in `callgraph.json` between the two zones is corroborated; one with no supporting calls is stale or wrong.</description>\n<parameter name=\"acceptanceCriteria\">[\"A declared seam is checked against the call graph when one is available\", \"A seam with no supporting evidence is marked as unverified in its panel rather than drawn identically to a corroborated one\", \"A seam naming callbacks that no longer exist in the target is reported to the reader\"]</parameter>\n<parameter name=\"tags\">[\"sourcevision\", \"isometric\", \"correctness\"]"
---
