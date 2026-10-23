---
id: "3e8d8551-2fd3-4006-803b-e96747fec318"
type: "change"
title: "Fix code in sourcevision-analyzers (2 findings)"
slug: "fix-code-in-sourcevision-analyzers-2"
intent: "- The sourcevision-analyzers zone is a degenerate 2-file zone containing only dead code (completion-reader.ts with zero production importers) and its own test. This zone will persist indefinitely unless a binary decision is made: delete both files if the module is abandoned, or add completion-reader to public.ts and wire it into the production pipeline if the export is intentional. Leaving the zone as-is gives sourcevision a misleading test coverage signal for a module with no callers.\n- Four enrichment passes have documented completion-reader.ts as dead code (zero production importers confirmed) with no deletion decision made. The sourcevision-analyzers zone will persist indefinitely as a 2-file satellite in zone reports, creating a false coverage signal. If no decision is made to wire it into the production pipeline (add to public.ts), schedule deletion of both completion-reader.ts and completion-reader.test.ts in the next dead-code cleanup PR."
touches:
  - "56f47d3d-d39d-4938-9923-b3735656ba7b"
priority: "high"
source: "sourcevision"
---
