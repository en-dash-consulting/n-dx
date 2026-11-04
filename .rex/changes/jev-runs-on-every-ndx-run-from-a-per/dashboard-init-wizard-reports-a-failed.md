---
id: "0fa67da8-bc41-44c8-9584-7aabe786e413"
type: "task"
title: "Dashboard init wizard reports a failed Google key store"
slug: "dashboard-init-wizard-reports-a-failed"
description: "Should-fix from the #952 review (the preflight half is task 1ef2f885). In packages/web/src/server/routes-commands.ts (~line 941) the wizard stores the Google key with `ndx config credentials.google --stdin`, then `.catch(() => {})`. exec never rejects, so the catch never runs; a failed store exits non-zero, nobody checks the exit code, and init still reports success — the typed key is lost silently. Since the store is now the only place the key goes, check exitCode and surface a failure (without the key) in the init result."
acceptanceCriteria:
  - "When ndx config credentials.google --stdin exits non-zero, the init wizard reports that the Google key was not stored and how to store it"
  - "The reported failure never contains the key"
  - "A successful store is unchanged"
priority: "medium"
tags:
  - "credential-store"
  - "review-followup"
  - "web"
source: "stack review of #942/#949/#952 (2026-11-03)"
blockedBy:
  - "1ef2f885-15d8-454a-839a-19c2a1f6422f"
---
