---
id: "9c999a92-f89f-469c-a527-5e4aaae920bf"
type: "change"
title: "Fix Codex output parser to capture next-line token count after 'tokens used' label"
slug: "fix-codex-output-parser-to-capture"
intent: "The existing Codex token extraction logic looks for a token count on the same line as the 'tokens used' marker. Codex actually prints 'tokens used' as a standalone label and puts the integer count on the line immediately following it. Update the parser to handle this two-line pattern: detect the 'tokens used' sentinel, then read the next non-empty line as the count. The fix should be backward-compatible in case future Codex versions collapse this back to one line."
acceptanceCriteria:
  - "Parser correctly extracts the integer token count when it appears on the line immediately after 'tokens used'"
  - "Parser also handles any pre-existing same-line pattern without regression"
  - "Extracted token count is stored and surfaced in hench run summary output"
  - "Extracted token count is recorded in the run log and propagated to token usage aggregation"
touches:
  - "ed1f0944-536d-44a4-ad18-d2f3e4827e16"
priority: "high"
tags:
  - "codex"
  - "token-usage"
  - "parser"
source: "smart-add"
---
