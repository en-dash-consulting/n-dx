---
id: "e813108f-27c4-4196-abbc-5cd52f4269b7"
type: "task"
title: "Address pattern issues (3 findings)"
slug: "address-pattern-issues-3-findings-e81310"
description: "- crash-detector.ts is placed under performance/ but serves crash recovery, not performance monitoring — the directory name creates a false affordance; relocating to a crash/ subdirectory and adding an index.ts barrel would align location with intent.\n- No internal barrel file exists to formalize the hook→component API surface; adding a status/index.ts would allow the hook and component to evolve independently without callers needing to track both module paths.\n- No unit or integration tests exist for any of the three page components; given that enrichment-thresholds.ts and suggestions.ts render dynamic analysis output, missing tests create an undetected regression surface for SourceVision output format changes."
priority: "high"
source: "sourcevision"
---
