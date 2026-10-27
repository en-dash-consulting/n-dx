---
id: "44c38797-0009-4f44-8adc-38b5bd5a830e"
type: "capability"
title: "Cross-PRD Duplicate Detection and Merge-Into-Older Semantics"
slug: "cross-prd-duplicate-detection-and"
statement: "When proposals are added through ndx add or rex add, the product checks them against items in every PRD file. A proposal that duplicates an existing item is merged into that item in the older PRD file, and every other proposal is written to the current branch's PRD file."
criteria: [{"id":"c1","text":"When checking a proposal for duplicates, the add pipeline shall compare it against items in all prd_*.json files, not only the current branch's file."},{"id":"c2","text":"When a duplicate is detected, the add pipeline shall identify the older PRD file by comparing the creation dates in the PRD filenames."},{"id":"c3","text":"When a duplicate is detected, the add pipeline shall write the merged item to the older PRD file rather than to the current branch's PRD file."},{"id":"c4","text":"When merging a newer proposal into an older item, the add pipeline shall keep the older item's existing acceptance criteria, tags and metadata while adding the proposal's new content."},{"id":"c5","text":"If a proposal is not a duplicate, the add pipeline shall add it to the current branch's PRD file."},{"id":"c6","text":"When ndx add writes new items, it shall create or append to the current branch's prd_{branch}_{date}.json file."},{"id":"c7","text":"When rex add --file imports items, rex shall write the new items to the current branch's PRD file."},{"id":"c8","text":"While proposals await approval, the approval flow shall display which PRD file they will be written to."},{"id":"c9","text":"When items arrive through piped input or a batch add, the add pipeline shall write them to the current branch's PRD file."}]
source: "smart-add"
---

Extend the ndx add duplicate detection pipeline to operate across multiple PRD files, merging newer duplicate proposals into the older PRD's existing item rather than creating duplicates across branch-scoped files.
