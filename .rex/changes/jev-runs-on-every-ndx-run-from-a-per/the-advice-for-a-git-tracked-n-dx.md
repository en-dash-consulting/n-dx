---
id: "09879815-d6cd-42b4-ab26-a156cdce8e61"
type: "task"
title: "The advice for a git-tracked .n-dx.local.json says the file's key stays in use until removed"
slug: "the-advice-for-a-git-tracked-n-dx"
description: "#956 review S5. packages/core/config.js:4555 tells the user 'Store your own with: ndx config credentials.<vendor>' when .n-dx.local.json is tracked and its keys are not imported. resolveVendorKey returns llm.<vendor>.api_key from config before the store, so the repository's key in that file is still the one sent; a user who follows the advice believes they switched keys. Add that the file's key stays in use until it is removed from that file, as showVendorApiKey's shadow line already says."
acceptanceCriteria:
  - "The message names the file and says its key is used instead of the store's until it is removed from that file (e2e)"
  - "No value is printed"
priority: "low"
source: "pr-956-review"
---
