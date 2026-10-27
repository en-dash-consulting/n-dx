---
id: "95bfdba2-2cba-4921-b614-3a34779e0892"
type: "capability"
title: "Natural language PRD authoring"
slug: "natural-language-prd-authoring"
statement: "The product turns plain-English descriptions into structured PRD items, using an LLM to organise them into the epic, feature and task hierarchy."
criteria: [{"id":"c1","text":"When a user gives a natural language description, the system shall use an LLM to structure it into items in the PRD hierarchy."},{"id":"c2","text":"When a user gives several natural language descriptions in one request, the system shall structure all of them into PRD items in one batch."},{"id":"c3","text":"When a user supplies a file as input, the system shall read the natural language descriptions in the file and create PRD items from them."}]
source: "llm"
---

Enable natural language input for PRD creation, allowing users to describe features in plain English and have them automatically structured into proper epic/feature/task hierarchies with AI assistance
