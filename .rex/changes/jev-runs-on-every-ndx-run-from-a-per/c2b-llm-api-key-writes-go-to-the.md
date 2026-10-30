---
id: "10730d82-59f1-4ea2-9594-667318da70d2"
type: "task"
title: "C2b: llm.*.api_key writes go to the credential store, with a one-time import from .n-dx.local.json"
slug: "c2b-llm-api-key-writes-go-to-the"
description: "PR 2. Done-when re-tightened against PR 1's merged code before PR 2 starts."
acceptanceCriteria:
  - "ndx config llm.<vendor>.api_key writes go to the store, not .n-dx.local.json"
  - "ndx config credentials offers to move an api_key from .n-dx.local.json into the store and removes it from the file"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "742863c5-989f-4138-8909-9b59bb589fc4"
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
---
