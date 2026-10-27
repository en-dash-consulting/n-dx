---
id: "4f0263fa-8da5-4a83-811c-01da1c4acdf7"
type: "change"
title: "Implement cross-PRD duplicate detection with merge-into-older-file resolution"
slug: "implement-cross-prd-duplicate"
intent: "Extend the existing smart-add duplicate matching to compare proposals against items in all PRD files. When a duplicate is found, determine which PRD file contains the older item (by file creation date from filename) and merge the newer proposal's content into that older item rather than creating a new entry in the current branch's PRD."
acceptanceCriteria:
  - "Duplicate detection scans items across all prd_*.json files, not just the current branch's file"
  - "When a duplicate is detected, the older PRD file is identified by comparing creation dates from filenames"
  - "Merge writes the updated item to the older PRD file, not the current branch's file"
  - "Merge preserves existing acceptance criteria, tags, and metadata from the older item while incorporating new content"
  - "Non-duplicate proposals are added to the current branch's PRD file as normal"
amends: [{"target":"44c38797-0009-4f44-8adc-38b5bd5a830e","delta":"modified","summary":"Implement cross-PRD duplicate detection with merge-into-older-file resolution","base":"46128ca5aa7ab49483594a7acafc29a1a2d56a1c6a07de5b49099996432b3cce"}]
priority: "high"
tags:
  - "rex"
  - "smart-add"
  - "dedup"
source: "smart-add"
---
