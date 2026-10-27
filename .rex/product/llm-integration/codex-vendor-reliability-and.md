---
id: "b3cbf38e-4757-4c5b-9a49-663cc8536533"
type: "capability"
title: "Codex Vendor Reliability and Documentation"
slug: "codex-vendor-reliability-and"
statement: "Hench records token usage accurately and derives task execution state consistently when it runs in Codex mode, and Rex shows accurate run counts and completion percentages."
criteria: [{"id":"c1","text":"When Hench runs in Codex mode, Hench shall record the token usage of each run so that usage reporting reflects the tokens actually consumed."},{"id":"c2","text":"When Hench runs in Codex mode, Hench shall enforce token budgets against the recorded Codex token usage."},{"id":"c3","text":"When a Codex-mode response's tool output differs in shape from the expected form, Hench shall still derive the task execution state consistently."},{"id":"c4","text":"The Hench sidebar shall display the run count that matches the recorded execution statistics."},{"id":"c5","text":"When Rex calculates a completion percentage, Rex shall exclude deleted items from the denominator in both the CLI and the web dashboard."}]
source: "smart-add"
---
