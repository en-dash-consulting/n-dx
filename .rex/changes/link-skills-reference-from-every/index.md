---
id: "d0319f99-42f9-4648-a064-6e52b32bb18a"
type: "change"
title: "Link skills reference from every instruction and workflow documentation page"
slug: "link-skills-reference-from-every"
intent: "Add a consistent 'Skills used in this workflow' or 'See: Skills reference' link from each existing instruction page (workflow guides, AGENTS.md, CLAUDE.md derived docs, README sections that describe ndx usage) to the new skills overview page. Where a page describes a workflow that triggers specific skills, call those skills out by name with anchor links into the reference. Ensure the linking is generated from the same manifest so adding a new skill or workflow does not silently drop the cross-reference."
acceptanceCriteria:
  - "Every existing workflow/instruction documentation page contains a visible link to the skills reference"
  - "Pages describing workflows that invoke specific skills include named, anchor-linked references to those skills"
  - "Cross-references are generated or verified against the assistant-assets manifest so new skills/pages don't fall out of sync"
  - "Regression test or lint check fails if an instruction page references a skill not present in the manifest, or vice versa for skill-bearing workflows"
touches:
  - "a7eef33f-fe81-4485-b945-fe62c9a53b55"
priority: "medium"
tags:
  - "documentation"
  - "skills"
source: "smart-add"
---
