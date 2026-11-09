---
id: "6995a75e-4590-46d6-b403-28587067d8aa"
type: "task"
title: "The LLM catalog reports an unprobeable saved host as unreachable instead of misconfigured"
slug: "the-llm-catalog-reports-an-unprobeable"
description: "buildLlmCatalog (routes-llm.ts ~1155 via llm-catalog.ts ~188) sets readiness to state unreachable with summary 'Not reachable · <host>:<port>' when the saved local host fails the shape check layer 5 added, so the vendor card claims a connection failure for a server that was never contacted; only the detail line carries the real reason. The readiness enum already has needs-setup. There is no catalog test for the local probe at all. Surfaced by the layer 5 review of stack #855."
acceptanceCriteria:
  - "A saved host that fails the shape check yields readiness state needs-setup with the shape error as the summary"
  - "A catalog test covers the local probe for a reachable, an unreachable and an invalid saved endpoint"
priority: "low"
source: "codeql-triage"
---
