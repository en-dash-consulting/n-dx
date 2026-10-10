---
id: "9702258d-7234-4551-a78a-01a8dace8fa6"
level: "task"
title: "Claude on Bedrock keeps role, container and CA credentials"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "In Bedrock mode the IRSA (AWS_WEB_IDENTITY_TOKEN_FILE, AWS_ROLE_ARN, AWS_ROLE_SESSION_NAME), ECS (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_CONTAINER_CREDENTIALS_FULL_URI, AWS_CONTAINER_AUTHORIZATION_TOKEN, AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE) and CA (AWS_CA_BUNDLE) names reach the child (test)"
  - "They are stripped when Bedrock mode is off (test)"
  - "When Bedrock or Vertex mode is on and none of its credential names are present, onStripped reports it once, with names only and never values (test)"
description: "Finding 3 on #623. packages/llm-client/src/child-env.ts resolveVendorCliEnv denies AWS_* wholesale, and Bedrock mode keeps only the static keys, the profile, the region and the config files. In Bedrock mode also keep AWS_WEB_IDENTITY_TOKEN_FILE, AWS_ROLE_ARN, AWS_ROLE_SESSION_NAME (EKS/IRSA); AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_CONTAINER_CREDENTIALS_FULL_URI, AWS_CONTAINER_AUTHORIZATION_TOKEN, AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE (ECS/Fargate); and AWS_CA_BUNDLE. When Bedrock or Vertex mode is on and none of that mode's credential names reached the child, report it once through onStripped (names only, never values). Do not widen beyond Bedrock and Vertex: Azure Foundry, Gemini on Vertex and Azure Codex stay in issue #635."
lastModified: "2026-10-10T18:09:35.809Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
