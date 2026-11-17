---
id: "50ba9fa8-d954-49ed-9ec3-cb82a6e84a12"
type: "task"
title: "Detect mirrored subtrees and count them once"
slug: "detect-mirrored-subtrees-and-count"
summary: "Recognise when a folder is a near-copy of another folder in the same repository, so its files aren't counted twice in the map and the migration numbers."
description: "**Problem (real deep run).** One top-level folder held a near-identical copy of another, about 650 files, which double-counted zones, imports, classifications and dynamic-code totals.\n\n**Fix.**\n- **Detection:** after inventory, find directory pairs where at least 90% of one side's files have an identical path suffix and an identical content hash in the other. Use the hashes inventory already computes, and keep it linear: group by content hash, then by relative path.\n- **Marking:** mark the smaller or later tree as a mirror of the other (`mirrorOf`), with the match ratio.\n- **Effect:** mirror files are kept out of zones and out of the totals, with a separate count, the way third-party files are. They stay in the inventory.\n- **Report:** one analyze log line per mirror pair.\n- **Override:** a config setting (`sourcevision.mirrors: { \"edit/\": \"app/\" }`) can set or deny a pair.\n\n**Tests:** an invented fixture with `app/x/**` and a near-copy `edit/x/**` with two differing files. Assert:\n- the mirror is detected at the right ratio;\n- zone membership and totals count those files once;\n- the differing files stay first-party;\n- the config override works."
acceptanceCriteria:
  - "A near-identical copy of a directory is marked as a mirror of its source with the match ratio"
  - "Mirror files are counted once in zones and migration totals, while the files that differ stay first-party"
  - "A config override can set or deny a mirror pair"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "sourcevision"
  - "duplication"
blockedBy:
  - "0b1480cf-c292-438f-b804-1689d3f31255"
---
