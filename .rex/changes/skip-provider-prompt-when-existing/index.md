---
id: "224703a3-3a67-44ef-9e01-375c0990827b"
type: "change"
title: "Skip provider prompt when existing config is valid"
slug: "skip-provider-prompt-when-existing"
acceptanceCriteria:
  - "Re-running ndx init with existing config skips provider prompt"
  - "Existing provider reported as reused"
  - "--provider=X still works to override"
touches:
  - "fa59f28a-e444-4451-b770-f965c8db1798"
priority: "medium"
tags:
  - "cli"
  - "ux"
---
