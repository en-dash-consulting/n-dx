---
id: "4fbde3c0-c586-45c1-9309-fab162520b05"
type: "change"
title: "Implement ANSI color-coded quota log formatter"
slug: "implement-ansi-color-coded-quota-log"
intent: "Write a pure formatting function that accepts the typed quota-remaining array and returns a human-readable string (or array of strings) with ANSI color codes applied per threshold: red (ANSI 31) when percent remaining is below 5%, yellow (ANSI 33) when between 5% and 10%, and default terminal color otherwise. The formatter should return an empty result when the input array is empty so callers can skip output with a simple length check."
acceptanceCriteria:
  - "Text is rendered yellow (ANSI 33) when percent remaining is >= 5% and < 10%"
  - "Text is rendered red (ANSI 31) when percent remaining is < 5%"
  - "Text uses default terminal color when percent remaining is >= 10%"
  - "Formatter returns empty output (empty string or empty array) when the quota-remaining input is empty"
  - "Output format includes provider/model and percent value (e.g., 'Claude: 8% remaining')"
amends: [{"target":"642df761-d076-4309-bd5c-edba76604dfd","delta":"modified","summary":"Implement ANSI color-coded quota log formatter","base":"729f559c0f66f8d68a92209c7e30f7dbf188c0e34ff28c73b2830c815f13747f"}]
priority: "medium"
tags:
  - "llm"
  - "quota"
  - "cli"
  - "hench"
source: "smart-add"
---
