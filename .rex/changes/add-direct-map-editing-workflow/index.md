---
id: "d8fc2e93-610c-4c56-ab47-2b5ad6e561db"
type: "change"
title: "Add direct map editing, workflow settings and Bitbucket remote parsing"
slug: "add-direct-map-editing-workflow"
intent: "Direct-edit form with an editorial checkbox; rex.applyOn and rex.placement.autoAccept on the Workflow settings page; routes-project derives the repository name through the shared remote-URL helper, so Bitbucket Cloud and Data Center remotes resolve as well as GitHub's."
acceptanceCriteria:
  - "Editorial edits keep status met through the UI (test)"
  - "Both settings save to .n-dx.json"
  - "Bitbucket remote URLs resolve the repository name (tests)"
amends: [{"target":"89ecd7f3-ca6a-4833-90a4-7bc7b1017e94","delta":"modified","summary":"Add direct map editing, workflow settings and Bitbucket remote parsing","base":"bad68c6e81838a16eb875c1a6756607b564680c32c334280531944ad6b185497"}]
priority: "medium"
tags:
  - "pr-21"
  - "lane-web"
  - "web"
source: "roadmap"
blockedBy:
  - "d8b23226-f958-4fba-a873-eb35c9045761"
  - "3d7747f6-a22a-41e1-bd4f-491f29f54191"
---
