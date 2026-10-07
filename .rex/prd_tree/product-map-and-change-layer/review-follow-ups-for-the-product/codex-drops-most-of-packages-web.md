---
id: "fabfa3a2-9ef6-4f3e-a6f7-80c2223c8657"
level: "task"
title: "Codex drops most of packages/web/AGENTS.md: root plus nested AGENTS.md exceeds its 32 KiB combined project-doc budget"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "core"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The current Codex default for project_doc_max_bytes and its combined-chain behaviour are confirmed against Codex's docs and cited in the test"
  - "A test fails when the root AGENTS.md plus any packages/*/AGENTS.md (and any deeper AGENTS.md on the same chain) exceeds the Codex budget minus a stated margin; it fails today for packages/web and packages/rex"
  - "Every package AGENTS.md chain fits the budget, so a Codex session under packages/web receives the injection-seam registry and the gateway boundary section"
  - "The changeset for b88dba61 no longer claims Codex receives package guidance it would truncate"
description: "Found by an adversarial review of commit 7e7ef5666 (task b88dba61, which gave every package CLAUDE.md an AGENTS.md counterpart). Verdict: should-fix. Introduced by that change: the nested AGENTS.md files are new.\n\nScenario: Codex concatenates AGENTS.md from the repo root down to the working directory and stops once the combined size reaches project_doc_max_bytes (32 KiB = 32768 by default; confirm against current Codex docs - this review could not reach the web). Measured after the change: root AGENTS.md is 29,591 bytes. Under packages/web the chain is 29,591 + 21,941 (packages/web/AGENTS.md) = 51,532 bytes, so roughly the first 3 KB of web's guidance survive - the zone-layering intro - and the request gate, workspace-scoped writes, hub zone, gateway boundary and injection-seam registry are all dropped. Under packages/rex the chain is 29,591 + 3,354 = 32,945, which clips the tail of rex's guidance (the stuck_parent paragraph). hench (31,621), core (31,885) and llm-client fit today with under 1.2 KB to spare. No error is raised and every test is green.\n\nSo the main claim of b88dba61 - \"Codex and any other assistant that reads nested AGENTS.md files now get them\" (also the wording of .changeset/package-agents-md-counterpart.md) - does not hold for web, the package with the most guidance.\n\nReachable: any Codex session whose working directory is under packages/web or packages/rex.\n\nRelated: d5ac48da tracks the root AGENTS.md alone approaching the limit and says nothing is truncated today. That is no longer true once nested files count against the same budget; this item is the combined-chain case and is already failing.\n\nOptions:\n(a) Recommended. Shrink the root AGENTS.md so a realistic chain fits: the MCP tool reference, skills list and Codex troubleshooting could move to nested or on-demand files, or the long concurrency-contract prose could be cut to rules plus a link. Then add a test that, for every packages/<pkg>/AGENTS.md (and any deeper AGENTS.md), asserts byteLength(root) + byteLength(nested chain) stays under 32768 minus a margin, with a failure message naming the Codex limit.\n(b) Split packages/web/AGENTS.md into nested files that mirror the .claude/rules path scoping: packages/web/src/server/AGENTS.md (request gate, workspace writes, seam registry), packages/web/src/viewer/AGENTS.md (gateway boundary), packages/web/src/hub/AGENTS.md. This shortens each chain but does not help a session rooted at packages/web itself, and with the root at 29.6 KB there is only ~3 KB of budget left regardless - so (b) alone is insufficient.\n(c) Have ndx init write a larger project_doc_max_bytes into .codex/config.toml for this repository. Cheap, but it only helps sessions that use the repo config, and it hides rather than fixes the growth.\nDecision for the owner: whether the root AGENTS.md or the package files give up bytes."
lastModified: "2026-10-06T23:17:46.605Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
