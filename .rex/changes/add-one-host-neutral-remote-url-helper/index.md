---
id: "3d7747f6-a22a-41e1-bd4f-491f29f54191"
type: "change"
title: "Add one host-neutral remote-URL helper in llm-client"
slug: "add-one-host-neutral-remote-url-helper"
intent: "Three places read a git remote today or soon: sourcevision's export/iso-sources.ts, the repo identity task in the cross-repo meta-scan feature, and web's routes-project.ts. Add one helper in @n-dx/llm-client that parses the origin URL into { host, owner/workspace, repo, kind: github | bitbucket-cloud | bitbucket-dc | other } for https, ssh and scp-style forms, and make every reader use it (web through its gateway). If the cross-repo meta-scan work lands the helper first, reuse it and close this task with that reference instead of writing a second one."
acceptanceCriteria:
  - "GitHub, Bitbucket Cloud and Bitbucket Data Center URLs parse in https, ssh and scp-style forms, one unit test per form"
  - "The host kind distinguishes github.com, bitbucket.org and a self-hosted Bitbucket Data Center host"
  - "No other module parses a git remote URL (search-based test or architecture policy rule)"
amends: [{"target":"89ecd7f3-ca6a-4833-90a4-7bc7b1017e94","delta":"modified","summary":"Add one host-neutral remote-URL helper in llm-client","base":"bad68c6e81838a16eb875c1a6756607b564680c32c334280531944ad6b185497"}]
priority: "medium"
tags:
  - "pr-21"
  - "lane-web"
  - "llm-client"
  - "host-neutral"
source: "roadmap"
---
