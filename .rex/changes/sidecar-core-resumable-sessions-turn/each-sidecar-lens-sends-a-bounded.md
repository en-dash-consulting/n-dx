---
id: "afc0a661-2cf4-42a6-9bc6-72cfc3e6d3ce"
type: "task"
title: "Each Sidecar lens sends a bounded, deterministic context packet"
slug: "each-sidecar-lens-sends-a-bounded"
description: "Packet builder framework (cap, provenance, staleness) with one builder per lens. CAOS story: https://www.notion.so/3f7a80b71924810499c9f380e11f53fd."
acceptanceCriteria:
  - "builders are LLM-free with snapshot tests"
  - "each packet respects its cap"
  - "the General lens sends no packet"
priority: "medium"
source: "caos"
---
