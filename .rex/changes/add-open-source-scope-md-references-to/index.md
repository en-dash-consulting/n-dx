---
id: "b74fb9f4-44c7-41ac-a0e2-9ecfd64befb7"
type: "change"
title: "Add OPEN_SOURCE_SCOPE.md references to README and key documentation pages"
slug: "add-open-source-scope-md-references-to"
intent: "Ensure OPEN_SOURCE_SCOPE.md is surfaced from the project's primary documentation entry points so contributors and evaluators can find it. Add explicit links or mentions in README.md, AGENTS.md, and CLAUDE.md (or the assistant-assets source template) so that open source scope is discoverable from the first document a reader encounters."
acceptanceCriteria:
  - "README.md contains at least one link to OPEN_SOURCE_SCOPE.md in a visible section (e.g., Contributing or License)"
  - "AGENTS.md or its source template (packages/core/assistant-assets/project-guidance.md) references OPEN_SOURCE_SCOPE.md"
  - "CLAUDE.md references OPEN_SOURCE_SCOPE.md so AI assistants surface it when relevant"
  - "All added links resolve to the correct relative path and the file exists at that path"
amends: [{"target":"491547b6-480e-4091-8b53-5c57a27bc5a5","delta":"modified","summary":"Add OPEN_SOURCE_SCOPE.md references to README and key documentation pages","base":"6150689592a0ee31bc9f18f38eea7f97a286808d568aee399bc9ec6972c90ade"}]
priority: "medium"
tags:
  - "docs"
  - "open-source"
source: "smart-add"
---
