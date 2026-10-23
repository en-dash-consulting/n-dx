---
id: "72d599a7-a398-405e-850d-9ae79659b15e"
type: "capability"
title: "Shared assistant guidance for every vendor"
slug: "shared-assistant-guidance-for-every"
statement: "n-dx gives every assistant vendor the same project guidance: the zone governance, gateway, spawn-versus-gateway and concurrency-contract sections reach AGENTS.md as well as CLAUDE.md, package guidance lives in each package's AGENTS.md, and the .claude/rules files only point to it."
criteria: [{"id":"c1","text":"When `ndx init` generates the root AGENTS.md, it shall include the gateway rules and the PRD write invariant."},{"id":"c2","text":"If a vendor-neutral section exists only in the Claude addendum, the instruction-alignment test suite shall fail."},{"id":"c3","text":"The rex, hench and web packages shall each keep their governance in a package AGENTS.md, and their CLAUDE.md shall only import that AGENTS.md."},{"id":"c4","text":"If a package CLAUDE.md has no sibling AGENTS.md, or holds content beyond importing AGENTS.md, the instruction-alignment test suite shall fail."},{"id":"c5","text":"The repository shall keep the gateway-boundary and injection-seam rules in a package AGENTS.md file, where every assistant can read them."},{"id":"c6","text":"If a .claude/rules seam registry is added for a package other than core or web, the instruction-alignment test suite shall fail."},{"id":"c7","text":"Each .claude/rules file shall contain only its frontmatter and a short pointer to the AGENTS.md section that holds the guidance, with no table rows and no second copy of any registry."},{"id":"c8","text":"The injection-seam rule files shall point a new package's registry at that package's AGENTS.md, cite packages/llm-client/ as the reference pair, and not tell authors to create a .claude/rules file for their package."},{"id":"c9","text":"If any file under .claude/rules/ contains a Markdown table row, whatever its name, the instruction-alignment test suite shall fail."},{"id":"c10","text":"If a file under .claude/rules/ does not name the AGENTS.md section it points at, the instruction-alignment test suite shall fail."}]
tags:
  - "product-map"
  - "pr-06"
  - "lane-core-docs"
  - "core"
source: "roadmap"
priority: "medium"
---

The zone governance, gateway, spawn-versus-gateway and concurrency-contract (including the PRD invariant) sections live only in packages/core/assistant-assets/claude-addendum.md, so AGENTS.md (Codex) never sees them. Move vendor-neutral content into project-guidance.md.

Roadmap PR 6 · wave 0 · lane core-docs.
