---
id: "ed1f0944-536d-44a4-ad18-d2f3e4827e16"
type: "capability"
title: "Codex Multi-line Token Count Parsing Fix"
slug: "codex-multi-line-token-count-parsing-fix"
statement: "The Codex output parser extracts the token count that Codex prints for a run, whether the count follows the 'tokens used' label on the same line or on the next line, and records it in the run's summary, log and token usage totals."
criteria: [{"id":"c1","text":"When Codex output contains a 'tokens used' label on its own line, the Codex output parser shall read the next non-empty line as the integer token count."},{"id":"c2","text":"When Codex output contains the token count on the same line as the 'tokens used' label, the Codex output parser shall extract that integer token count."},{"id":"c3","text":"When the Codex output parser extracts a token count, hench shall store it and show it in the run summary output."},{"id":"c4","text":"When the Codex output parser extracts a token count, hench shall record it in the run log and include it in token usage aggregation."}]
source: "smart-add"
---

Codex CLI emits token usage across two lines: the label 'tokens used' on one line and the numeric count on the immediately following line. The current parser does not capture this two-line pattern, so Codex credit consumption goes unrecorded in run summaries and budget tracking.
