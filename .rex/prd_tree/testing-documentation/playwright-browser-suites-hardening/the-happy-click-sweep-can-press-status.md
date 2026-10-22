---
id: "eb5b10af-5b4d-40be-856f-6e72151848bf"
level: "task"
title: "The happy-click sweep can press status-picker options: the listbox is never dismissed and option names are not denied"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "settle() dismisses an open listbox the same way it dismisses dialogs and menus"
  - "The status option names are in DENY_NAME, and the sweep's attached report for /prd lists them as skipped"
description: "Severity: low (fixture-local write, not a page error). Verdict: should-fix — the click policy promises the sweep never writes.\n\npackages/web/tests/e2e-ui/happy-click/helpers/sweep.ts settle() presses Escape only when a [role=dialog] or [role=menu] is open. The PRD tree's status picker (components/prd-tree/inline-status-picker.ts) is a [role=listbox] of button options, so after the sweep presses \"Change status of <title>\" the picker stays open and its options (\"Completed\", \"In Progress\", …) are candidates; only \"Deleted\" is caught by the deny list's /^delete/i. The sweep's PRD run can therefore set the fixture task to completed. Fix: dismiss [role=listbox] in settle() as well, and deny the status option names in click-policy.ts."
lastModified: "2026-10-13T19:10:34.032Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
