---
id: "46ebab93-68f7-4dfd-bea6-b3e4f6abc1e0"
type: "change"
title: "Replace hardcoded 'ndx' command references in dashboard UI with project-resolved CLI name"
slug: "replace-hardcoded-ndx-command"
intent: "Audit the web dashboard for all hardcoded 'ndx' strings used as command prefixes in button labels, help text, code snippets, onboarding tips, and the Commands section. Replace each with the cliName value from shared state so users in projects with a different CLI binary name see correct guidance throughout the dashboard."
acceptanceCriteria:
  - "All dashboard UI strings that display CLI command syntax reference cliName from shared state instead of hardcoded 'ndx'"
  - "The PR description includes an audit checklist enumerating every changed file and replaced occurrence"
  - "A test or snapshot confirms that setting cliName to 'myapp' updates all visible command labels across at least three distinct dashboard views"
  - "No hardcoded 'ndx' strings remain in dashboard component templates outside of non-display identifiers (e.g. internal route names, config keys, data-testid attributes)"
amends: [{"target":"24f931c4-2411-44c9-9325-d82e06558159","delta":"modified","summary":"Replace hardcoded 'ndx' command references in dashboard UI with project-resolved CLI name","base":"c2992df5a43b2b6a13a4f352e367449b5b0651c8e552ee324d724310e3d1b418"}]
priority: "medium"
tags:
  - "web"
  - "ui"
  - "identity"
source: "smart-add"
---
