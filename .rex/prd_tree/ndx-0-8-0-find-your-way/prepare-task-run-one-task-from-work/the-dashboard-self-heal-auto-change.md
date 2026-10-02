---
id: "0f343cdc-d118-40e1-83ef-ed658f998a99"
level: "task"
title: "The dashboard Self-Heal --auto change has no changeset"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "release"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A patch changeset for @n-dx/web describes the Self-Heal --auto change and the dashboard consent step that replaces the CLI prompt."
description: "Verdict: should-fix (cheap; release notes).\n\nScenario: commit 05316436f changed routes-commands.ts:791 to pass --auto, which also bypasses self-heal's own confirmation, but no .changeset entry describes it. Confirm the viewer's 'I understand — proceed' step runs before the POST and say so in the changeset. Fix: add a patch changeset for @n-dx/web describing the change and the consent step."
lastModified: "2026-10-02T07:47:58.871Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
