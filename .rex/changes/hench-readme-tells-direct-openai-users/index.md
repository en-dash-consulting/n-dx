---
id: "49925594-3a5b-42e4-9dca-0f7c79990762"
type: "change"
title: "Hench README tells direct OpenAI users that model and vendor failover is unavailable"
slug: "hench-readme-tells-direct-openai-users"
intent: "The Direct OpenAI task execution section in packages/hench/README.md:172 says model/vendor failover is not enabled. A user following that section with llm.autoFailover=true, a supported initial model and suitable API credentials can see a retryable OpenAI error switch the run to another model or to Claude. This medium-severity documentation defect predates the dashboard repair. Update that sentence to document the opt-in bounded fallback sequence, or link to the configuration guide that describes it. A link keeps the package instructions accurate without duplicating resolver policy."
acceptanceCriteria:
  - "The Hench README directs users of direct OpenAI execution to the llm.autoFailover opt-in and its bounded behavior, either inline or via the configuration guide."
  - "A documentation check of the direct OpenAI section fails if the current sentence claiming failover is unavailable returns."
touches:
  - "2e136c81-64ea-4b4f-96ad-d070f98665e1"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
