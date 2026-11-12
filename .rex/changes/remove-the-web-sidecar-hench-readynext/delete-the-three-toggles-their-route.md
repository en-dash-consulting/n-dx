---
id: "8f9d1931-a290-499a-9978-f7fdd58b93b4"
type: "task"
title: "Delete the three toggles, their route gates and every read of them"
slug: "delete-the-three-toggles-their-route"
description: "Remove the registry entries, the five ROUTE_FEATURE_GATES rows, the viewer useFeatureToggle reads, the hub session host feature check and its refusal, the hub snapshot SIDECAR_OFF case, the lens-packet feature prerequisites and the readyNext check in routes-sidecar.ts. Rewrite or drop the tests that exercise the off state."
acceptanceCriteria:
  - "Searching packages/web/src for \"web.sidecar\", \"hench.readyNext\" and \"git.branchHealth\" finds no toggle reads"
  - "The web test suite passes"
priority: "medium"
tags:
  - "feature-flags"
  - "sidecar"
source: "ndx-capture"
---
