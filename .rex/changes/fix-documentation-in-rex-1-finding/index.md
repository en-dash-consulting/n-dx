---
id: "27e2cb62-a5ac-4c35-bded-8fe671973086"
type: "change"
title: "Fix documentation in rex (1 finding)"
slug: "fix-documentation-in-rex-1-finding"
intent: "- Document the CLI two-tier API pattern in CLAUDE.md with an explicit allowlist of approved internal sub-zones for CLI imports (analyze/index, store/, recommend/conflict-detection, fix/index). This converts the current undocumented privileged-consumer surface into a governed one. Without documentation, every new CLI command author independently discovers (or violates) this pattern with no authoritative precedent to consult."
touches:
  - "b3e82a63-746a-474e-af59-947d8a0f0fb9"
priority: "high"
source: "sourcevision"
---
