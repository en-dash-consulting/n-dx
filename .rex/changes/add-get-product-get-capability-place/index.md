---
id: "9a441abb-fc5c-4402-a14d-dfd24b3034e5"
type: "change"
title: "Add get_product, get_capability, place_change and apply_change"
slug: "add-get-product-get-capability-place"
intent: "New tools in their own modules. get_prd_status reports per area and per release."
acceptanceCriteria:
  - "Each tool has unit tests and is listed in tools/list"
  - "mcp-transport e2e covers one call to each new tool"
amends: [{"target":"5cfa1d83-839a-47a1-ae42-4353cd1acf83","delta":"modified","summary":"Add get_product, get_capability, place_change and apply_change","base":"999e84fb6272983f38e25ab04274b9ad7c1759cb581a1ac04f799e81391ca35c"}]
priority: "high"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
source: "roadmap"
blockedBy:
  - "fdddee24-1661-4f65-adc7-3946452bc8f8"
---
