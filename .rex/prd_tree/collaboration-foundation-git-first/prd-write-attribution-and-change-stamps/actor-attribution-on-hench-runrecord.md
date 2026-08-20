---
id: "1677cbb6-9e15-4c05-bd99-974f58f243da"
level: "task"
title: "Actor attribution on hench RunRecord"
status: "pending"
priority: "medium"
acceptanceCriteria: []
description: "RunRecord has no user/host attribution — runs are anonymous. Stamp actor (name/email) and optional host on RunRecord at run start, reusing the rex identity util through the established gateway pattern (src/prd/rex-gateway.ts) or a local copy if the gateway surface should not grow. PR boundary: hench package only. Acceptance criteria: (1) new runs carry actor; (2) schema change is additive — existing run files still parse; (3) run summary/show surfaces the actor; (4) unit test covers a run record with and without actor."
---
