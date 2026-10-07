---
id: "5fd641c6-0cab-493b-a934-be788ae4463f"
level: "task"
title: "Codex never sees the per-package governance or the path-scoped rules, because they live only in Claude-loaded files"
status: "cancelled"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
resolutionType: "acknowledgment"
resolutionDetail: "Superseded (triage 2026-10-07). PR 6 (#530) gave core, hench, llm-client, rex and web their own AGENTS.md, so per-package governance now reaches Codex. What remains is tracked elsewhere: the three .claude/rules files (f2d64d8a, PR 6) and the size limit that truncates web's AGENTS.md (fabfa3a2)."
acceptanceCriteria:
  - "A Codex session started under packages/web receives the web gateway-boundary and injection-seam rules from an AGENTS.md it loads automatically"
  - "Per-package guidance has a single canonical source, and a drift test fails when the Claude and Codex renderings diverge"
  - "The shared guidance no longer points Codex at .claude/rules/ as path-scoped rules it cannot load, or it states plainly that those files must be read by hand"
description: "Pre-existing. Surfaced by an adversarial review of commit dd765faaf but not introduced by it. Verdict: out-of-scope for that change.\n\nScenario: the zone governance for web, rex and hench lives in packages/web/CLAUDE.md, packages/rex/CLAUDE.md and packages/hench/CLAUDE.md. The web gateway boundary exemptions and the injection-seam registries live in .claude/rules/*.md. Claude Code loads these automatically when it works under those directories. Codex loads only AGENTS.md files, and the repository has no nested AGENTS.md (no packages/*/AGENTS.md). A Codex agent editing packages/web therefore never learns the web-specific gateway exemptions or the seam registry. The shared guidance even points it at \".claude/rules/web-gateway-boundary.md\" as \"path-scoped rules\", which Codex has no mechanism to load. The tests still enforce the boundaries (domain-isolation.test.js, boundary-check.test.ts), so the failure shows up as a red CI run and a wasted Codex iteration rather than a silent violation.\n\nReachable: yes. It happens on any Codex session working inside packages/web, packages/rex or packages/hench.\n\nOptions:\n(a) Generate packages/<pkg>/AGENTS.md from the same source as each package's CLAUDE.md, through the asset pipeline, so both vendors load per-directory guidance. Recommended. This needs a source-of-truth decision first: either move the package CLAUDE.md bodies into assistant-assets, or render AGENTS.md from the CLAUDE.md files. A drift test must cover the result.\n(b) Inline short summaries of the per-package rules into project-guidance.md. This is cheaper, but it grows AGENTS.md toward the Codex size limit (see sibling task d5ac48da) and duplicates content.\nDecision for the owner: which file is canonical for per-package guidance."
lastModified: "2026-10-07T21:53:42.383Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
