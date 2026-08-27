---
id: "bcc8d2de-752a-4f01-ad59-18b4be58a61f"
level: "task"
title: "Source Vision Vendor Artifact Exclusion"
status: "completed"
priority: "high"
startedAt: "2026-07-09T23:11:49.496Z"
completedAt: "2026-07-10T00:16:40.266Z"
endedAt: "2026-07-10T00:16:40.266Z"
acceptanceCriteria: []
description: "Type: Bug. Prevent vendor artifacts from being scanned or classified as source logic in Source Vision.\n\nUser Story: As an N-DX user, I want vendor artifacts excluded from Source Vision analysis, so that generated insights focus on relevant source code.\n\nAcceptance Criteria:\n- Given a repository includes vendor artifacts, when Source Vision scans the project, then vendor artifacts are excluded from source logic classification.\n- Given excluded artifacts are detected, when scan results are generated, then they do not inflate or distort source analysis.\n- Given exclusion rules are applied, when the scan completes, then relevant source files remain included.\n\nNotes: May align with broader Source Vision classification cleanup."
---
