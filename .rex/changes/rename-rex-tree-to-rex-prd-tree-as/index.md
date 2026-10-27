---
id: "c94d8eed-5685-48c6-8263-d796974538ed"
type: "change"
title: "Rename .rex/tree to .rex/prd_tree as Canonical PRD Storage Location"
slug: "rename-rex-tree-to-rex-prd-tree-as"
intent: "Rename the canonical PRD folder-tree storage directory from .rex/tree to .rex/prd_tree across all read/write call sites, configuration, documentation, and tests. The new name communicates more clearly that this directory holds the authoritative PRD task hierarchy and avoids the generic 'tree' name."
touches:
  - "5ec16345-5c46-4197-9fa3-bcb50d58ce19"
source: "smart-add"
---
