---
id: "c1589e68-40c4-46c7-8489-f0a99fbadfb3"
type: "change"
title: "Make the MCP and CLI write paths agree on the slug convention"
slug: "make-the-mcp-and-cli-write-paths-agree"
intent: "The two write paths currently emit different slug conventions, so the tree flip-flops on alternating writes regardless of which convention is intended. Observed 2026-09-01: a single `mcp__rex__update_task_status` call rewrote 823 files, dropping the `-<shortId>` suffix and un-truncating titles (`child-process-cleanup-and-exit-b67648` -> `child-process-cleanup-and-exit-hygiene`); all renames were R100 with zero content loss and `rex validate` still passed 10/10. A subsequent `rex update` through the CLI re-serialized the whole tree back to the id-qualified form. The MCP output matches `slugifyTitle()` (the pre-uniqueness form) while the CLI matches `slugify()`. Worth fixing before the convention change and independently of it: a one-field status update should not rewrite 823 files, and the churn would swamp any PR diff. Fix the divergence first against whichever convention is current, so the later rename is a single deliberate change rather than noise on top of an oscillation."
acceptanceCriteria:
  - "The MCP and CLI write paths produce byte-identical trees for the same document"
  - "A single status update touches only the affected item and its ancestor index files"
  - "A regression test writes the same change through both paths and asserts the trees match"
touches:
  - "c83eecc7-a23e-4a3e-aeee-fc022dea0fc1"
priority: "high"
source: "ndx-capture"
---
