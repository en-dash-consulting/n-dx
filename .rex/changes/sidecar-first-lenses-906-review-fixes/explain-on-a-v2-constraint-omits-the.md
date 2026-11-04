---
id: "a8004447-2882-42bc-84e8-13e6fce07c4b"
type: "task"
title: "Explain on a v2 constraint omits the changes that touch it and their commit evidence"
slug: "explain-on-a-v2-constraint-omits-the"
description: "Verdict should-fix (low). packet-builders.ts v2ConstraintSections returns ids: [node.id] and no \"Linked changes\" section, while v2CapabilitySections lists report.changes and feeds their subtree ids to evidenceSections. Trailer commits name tasks, not product nodes, so for a constraint touched by changes (e.g. the trust constraint touched by the credential-store change) the packet's evidence section reads \"No commit names these items in an N-DX-Item trailer.\" and the zone section is a gap. EXPLAIN_INSTRUCTIONS says use only what the packet states, so the model reports no work or evidence for a constraint that has both. Reachable: Sidecar Explain lens on any constraint id. Fix (recommended, cheap): extract the capability's linked-changes section and change-subtree id collection into helpers and reuse them in v2ConstraintSections. Found by the automated adversarial review of b3ab2240."
acceptanceCriteria:
  - "Explain on a v2 constraint that a change touches lists that change under Linked changes"
  - "Explain on such a constraint passes the change's subtree ids to the evidence read, so a trailer commit naming its task appears under Trailer-commit evidence"
  - "A test in sidecar-packets.test.ts covers both"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
