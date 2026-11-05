---
id: "123bf048-b90c-4bc2-9ead-1ab2ca059e5d"
type: "task"
title: "Sidecar settings Save writes part of the allow-list before refusing a never-allow-listed command"
slug: "sidecar-settings-save-writes-part-of"
description: "Verdict: should-fix (medium), found by the adversarial review of task 613fc6f0.\n\nScenario: on Settings > Workflow > Sidecar the operator stages `ndx status .`, then `ndx work .`, removes a rule and edits a ceiling, then presses Save. `useSidecarSettingsForm.save` (packages/web/src/viewer/views/sidecar-settings.ts, the save loop) POSTs each staged add in order. `ndx status .` is written, `ndx work .` gets a 409, and Save stops there: the removal and the ceiling edit are not written. The page also does not reload, so `ndx status .` still shows as \"unsaved\" although it is already on the allow-list. A locked command can be staged at all, because Add sends it to the server only at Save.\n\nReachable: yes. The operator types a work/reset/push command in the Add box, which the locked rows invite.\n\nOptions:\n1. Refuse at Add time. A new `POST /api/sidecar/allow-list?dryRun=1`, or a `GET /api/sidecar/allow-list/check`, answers allowListKey's verdict without writing. The form calls it on Add and shows the server's message inline. Cost: one route branch plus a fetch. Keeps a single source of truth (broker-policy). Recommended.\n2. Validate every staged add before writing anything: a batch endpoint that checks all adds and applies them only when all are allowed. Cost: a new route shape.\n3. After any partial failure, reload the rules and drop the staged edits that already landed. Cheap, but Save is still not atomic."
acceptanceCriteria:
  - "Adding `ndx work .`, `git reset --hard` or `git push` in the allow-list editor shows the server's refusal at Add time, and the command is never staged (viewer test)"
  - "With one valid and one refused command staged, Save writes neither the valid rule nor the other Sidecar settings (viewer test)"
  - "After a Save that fails part-way, the allow-list shown matches the broker's allow-list file (viewer test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
