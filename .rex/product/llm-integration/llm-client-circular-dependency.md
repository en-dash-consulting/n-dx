---
id: "9dc20526-2080-456f-a3f4-163a748cb89b"
type: "capability"
title: "LLM Client Circular Dependency Resolution"
slug: "llm-client-circular-dependency"
statement: "The LLM client package's modules import one another without any circular dependency."
criteria: [{"id":"c1","text":"The LLM client package shall keep its module import graph free of circular dependencies."}]
source: "smart-add"
---
