---
id: "4ceadf67-034a-4052-8e0f-af2d9ff097f4"
type: "capability"
title: "Git-derived completion gate must recognize API-loop writes"
slug: "git-derived-completion-gate-must"
statement: "Hench's git-derived completion gate recognizes the file writes an API-loop run makes after its baseline as real changes, and still refuses completion claims backed by no agent work or by .rex/.hench bookkeeping alone."
criteria: [{"id":"c1","text":"When an API-loop run writes a tracked file after its baseline is captured, the completion gate shall recognize the run as changed and shall let the task proceed to completion."},{"id":"c2","text":"When an API-loop run creates a new file after its baseline is captured, the completion gate shall recognize the run as changed and shall let the task proceed to completion."},{"id":"c3","text":"If a run claims completion without having done any agent work, the completion gate shall reject the completion."},{"id":"c4","text":"If the only changes since the baseline are .rex or .hench bookkeeping files, the completion gate shall not accept them as meaningful work."}]
requirements: [{"id":"4ceadf67-034a-4052-8e0f-af2d9ff097f4:c1","title":"When an API-loop run writes a tracked file after its baseline is captured, the completion gate shall recognize the run as changed and shall let the task proceed to completion","description":"Linked to: packages/hench/tests/integration/gate-holds-completion.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When an API-loop run writes a tracked file after its baseline is captured, the completion gate shall recognize the run as changed and shall let the task proceed to completion."]}]
source: "ndx-capture"
priority: "high"
---

CI run 35000812304 fails five Hench API-loop integration tests after the main merge. Tool-driven writes are rejected as no meaningful change by the git-derived completion gate, even though the fixtures produce real output. Repair the production changed-file and completion-validation path rather than weakening the completion requirement or merely changing test expectations.
