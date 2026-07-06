---
id: "f771e5ca-0ad1-451f-9032-e2baba69e61d"
level: "task"
title: "Source Vision Build and Config Artifact Classification"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "Type: Bug. Improve Source Vision classification so build and configuration artifacts are not incorrectly treated as core source logic.\n\nUser Story: As an N-DX user, I want Source Vision to classify build and configuration artifacts correctly, so that analysis results are accurate and useful.\n\nAcceptance Criteria:\n- Given a repository includes build or configuration artifacts, when Source Vision scans the project, then those artifacts are classified appropriately.\n- Given artifacts are not core source logic, when results are generated, then they are separated from source logic analysis.\n- Given classification rules are updated, when a project is rescanned, then source analysis becomes less noisy.\n\nNotes: Should be considered alongside vendor artifact exclusion."
---
