---
id: "8be8d4fd-186f-4b70-b7ab-7c91f8a57134"
type: "change"
title: "Implement PRD file discovery and selection logic within the .rex directory"
slug: "implement-prd-file-discovery-and"
intent: "Add a discovery layer that scans the .rex/ directory for all prd_*.json files, parses their branch segments to match against the current branch, and either returns the existing PRD file path or creates a new file following the naming convention. This becomes the single entry point for resolving which PRD file to use for the current branch context."
acceptanceCriteria:
  - "Discovers all prd_*.json files in the .rex/ directory via glob pattern"
  - "Matches discovered files to the current branch by parsing the branch segment from filenames"
  - "Returns the existing PRD file path when one matches the current branch"
  - "Creates a new empty PRD file with correct naming when no match exists for the current branch"
  - "Handles concurrent existence of PRD files for multiple branches without interference"
amends: [{"target":"f648a519-2015-486a-849f-782ba79e970f","delta":"modified","summary":"Implement PRD file discovery and selection logic within the .rex directory","base":"bf1f4510bda04991cbee3442f87f02cc02ed516a47b80e3495c9910f3a242350"}]
priority: "critical"
tags:
  - "rex"
  - "storage"
source: "smart-add"
---
