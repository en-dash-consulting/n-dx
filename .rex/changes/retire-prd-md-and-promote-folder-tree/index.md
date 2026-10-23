---
id: "7145d6bc-5c6c-46bb-af89-cc65da8337f2"
type: "change"
title: "Retire prd.md and Promote Folder-Tree to Exclusive PRD Backend"
slug: "retire-prd-md-and-promote-folder-tree"
intent: "Flip the PRDStore read/write layer so the epic → feature → task → subtask folder tree is the sole authoritative storage. Remove all remaining paths that read from or write to prd.md so that file is never created, consulted, or maintained by any part of the system."
touches:
  - "5ec16345-5c46-4197-9fa3-bcb50d58ce19"
source: "smart-add"
---
