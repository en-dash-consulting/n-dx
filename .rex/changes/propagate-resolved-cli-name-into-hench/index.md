---
id: "7828dbab-faa4-4eb8-b356-70e0c736d4f7"
type: "change"
title: "Propagate resolved CLI name into hench agent prompts and task briefs"
slug: "propagate-resolved-cli-name-into-hench"
intent: "Hench agents currently hardcode 'ndx' in system prompts and task briefs when referencing CLI commands. Replace these with the resolved cli.name so agents working in a project using a different command name will correctly reference commands in generated code, commit messages, documentation, and verbal instructions to the user."
acceptanceCriteria:
  - "Hench brief builder reads cli.name from project config and injects it as a named template variable in system prompts and task briefs"
  - "All hardcoded 'ndx' CLI-invocation references in agent system prompt templates are replaced with the resolved variable"
  - "Integration test confirms that a hench run with cli.name='myapp' receives 'myapp' in its rendered prompt context, not 'ndx'"
  - "No hench tool implementation files are modified — changes are limited to prompt templates and brief construction"
  - "Existing prompt snapshot or content tests are updated to assert the resolved name rather than the literal string 'ndx'"
touches:
  - "a9fcab05-166f-43eb-81f7-05f8c3cef117"
priority: "high"
tags:
  - "hench"
  - "agent"
  - "identity"
  - "prompts"
source: "smart-add"
---
