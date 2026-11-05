---
id: "4dd0f364-a55c-462d-88c6-f2437a05ed17"
type: "task"
title: "Sidecar spend lands in the usage ledger as its own bucket with the lens"
slug: "sidecar-spend-lands-in-the-usage"
description: "Story 13. Mock: Drawer states C board. CAOS story: https://www.notion.so/3f7a80b71924816682dccb222aadb6f3."
acceptanceCriteria:
  - "Each finished Sidecar turn appends one .n-dx-web-usage.jsonl line with command \"sidecar\", vendor, model, tokens, outcome and, when set, lens (tested)"
  - "LLM Utilization shows a sidecar bucket (tested)"
  - "A usage line with an unknown field still parses in the current reader (tested)"
  - "The sessions response carries each session estimated cost (tested)"
priority: "medium"
source: "caos"
---
