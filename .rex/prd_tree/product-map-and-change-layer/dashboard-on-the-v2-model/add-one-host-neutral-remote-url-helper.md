---
id: "3d7747f6-a22a-41e1-bd4f-491f29f54191"
level: "task"
title: "Add one host-neutral remote-URL helper in llm-client"
status: "pending"
priority: "medium"
tags:
  - "pr-21"
  - "lane-web"
  - "llm-client"
  - "host-neutral"
source: "roadmap"
acceptanceCriteria:
  - "GitHub, Bitbucket Cloud and Bitbucket Data Center URLs parse in https, ssh and scp-style forms, one unit test per form"
  - "The host kind distinguishes github.com, bitbucket.org and a self-hosted Bitbucket Data Center host"
  - "No other module parses a git remote URL (search-based test or architecture policy rule)"
description: "Three places read a git remote today or soon: sourcevision's export/iso-sources.ts, the repo identity task in the cross-repo meta-scan feature, and web's routes-project.ts. Add one helper in @n-dx/llm-client that parses the origin URL into { host, owner/workspace, repo, kind: github | bitbucket-cloud | bitbucket-dc | other } for https, ssh and scp-style forms, and make every reader use it (web through its gateway). If the cross-repo meta-scan work lands the helper first, reuse it and close this task with that reference instead of writing a second one."
lastModified: "2026-10-06T15:51:48.917Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
