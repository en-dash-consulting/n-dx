---
id: "b3ab2240-ea5d-4c04-80c4-e86d3d22c9f1"
type: "task"
title: "Explain on a v2 constraint shows its statement and requirements"
slug: "explain-on-a-v2-constraint-shows-its"
description: "#906 F3 (low, should-fix). buildExplainPacket (packet-builders.ts) has branches for area and capability product nodes only. A constraint falls through to findNode and v1ItemSections, which reads only acceptanceCriteria, so the packet says \"Done when (acceptance criteria, not capability criteria): (none)\", shows the raw status instead of the derived status and health, and leaves out the statement and requirements. EXPLAIN_INSTRUCTIONS says to use only what the packet states, so the model reports the constraint has nothing to satisfy.\n\nDecided: add a constraint branch next to capability, reusing v2CapabilitySections' status section.\n\nSource: Adversarial review by Hal (endash-shal), 2026-11-04 on #906."
acceptanceCriteria:
  - "Explain on a v2 constraint builds a constraint section with its statement, requirements and appliesTo, and the computeProductStatus verdict under standing requirements, instead of the v1 item view"
  - "A snapshot test covers Explain on a constraint"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "review:#906-F3"
source: "ndx-adversarial-review"
---
