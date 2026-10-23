---
id: "81c3499f-0526-4dd4-8979-e273596a01bd"
type: "change"
title: "Add CLI startup deprecation filter as a belt-and-suspenders guard"
slug: "add-cli-startup-deprecation-filter-as"
intent: "Even after the root-cause fix, future dependency upgrades could reintroduce DEP0040 or similar deprecation noise. Add a targeted process-level warning filter at the CLI entry points (packages/core cli.js, and any package bin entry points) that silences known Node.js built-in deprecation codes (DEP0040 at minimum) without broadly suppressing all warnings. Include a CI assertion that no unfiltered deprecation lines appear in standard CLI smoke output."
acceptanceCriteria:
  - "A narrow warning filter targeting DEP0040 (and any other known-noisy built-in deprecations) is applied before CLI argument parsing begins"
  - "The filter does not suppress application-level or user-generated warnings — only Node.js built-in deprecation codes in the allowlist"
  - "A CI smoke test asserts that stdout and stderr from `ndx --version` contain no 'DeprecationWarning' lines"
  - "Filter logic is co-located in a single shared module imported by all CLI entry points, not duplicated per-binary"
amends: [{"target":"9aaa6f12-199e-4737-9b0e-737a76ed23fc","delta":"modified","summary":"Add CLI startup deprecation filter as a belt-and-suspenders guard","base":"97850128ad42cb6f672aae6d650909249d354210cdd3557f44b49ae65a3cc7ed"}]
priority: "low"
tags:
  - "cli"
  - "dx"
  - "node"
  - "ci"
source: "smart-add"
---
