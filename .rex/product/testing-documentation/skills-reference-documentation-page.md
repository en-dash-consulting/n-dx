---
id: "a7eef33f-fe81-4485-b945-fe62c9a53b55"
type: "capability"
title: "Skills Reference Documentation Page"
slug: "skills-reference-documentation-page"
statement: "The ndx documentation provides a skills reference page that catalogs every skill bundled with ndx, with each skill's purpose, trigger condition and customization guidance, and every instruction and workflow page links to it."
criteria: [{"id":"c1","text":"The skills reference page shall list every skill registered in packages/core/assistant-assets/."},{"id":"c2","text":"The skills reference page shall give each skill's name, a one-line purpose, its trigger condition and a note on customizing or extending it."},{"id":"c3","text":"The skills reference page shall include a section explaining how a user adds or overrides a skill in their own project."},{"id":"c4","text":"The skills reference page shall render correctly as standalone markdown and, where it is served there, in the web dashboard."},{"id":"c5","text":"The documentation tooling shall generate or verify the skill inventory on the skills reference page against the assistant-assets manifest."},{"id":"c6","text":"Every workflow and instruction documentation page shall contain a visible link to the skills reference page."},{"id":"c7","text":"When a documentation page describes a workflow that invokes specific skills, the page shall name those skills with anchor links into the skills reference."},{"id":"c8","text":"The documentation tooling shall generate or verify the cross-references to the skills reference against the assistant-assets manifest."},{"id":"c9","text":"If an instruction page references a skill that is not in the manifest, or a skill-bearing workflow lacks its skill references, the documentation check shall fail."}]
source: "smart-add"
---

Add a centralized documentation page that catalogs all skills bundled with ndx (e.g. dev-link, triage, update-config, simplify, no-plan-mode, etc.) with descriptions, trigger conditions, and customization guidance. Link to this page from every existing instruction/workflow page so users discover which skills are active when they use ndx and how to modify or add their own.
