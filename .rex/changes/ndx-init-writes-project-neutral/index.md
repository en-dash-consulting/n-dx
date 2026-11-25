---
id: "4e51e54c-2da5-46d0-9728-f15f67685c7e"
type: "change"
title: "ndx init writes project-neutral assistant guidance and keeps what the project wrote"
slug: "ndx-init-writes-project-neutral"
summary: "Setting up n-dx in someone's project currently fills its assistant instruction files with notes about n-dx's own source code, overwrites what the project already had there, and adds a README pointing at a LICENSE that may not exist. Every project should instead get short guidance about using n-dx, keep its own notes, and get a README only when it asks for one."
intent: "Reported by downstream users running `ndx init` in fresh and existing repositories (seen on 0.9.0, still so on 0.10.5).\n\n**Guidance.** getProjectGuidance() (packages/core/assistant-assets.js) reads packages/core/assistant-assets/project-guidance.md for every project, and renderClaudeMd / renderAgentsMd build CLAUDE.md and AGENTS.md from it. That file is the n-dx monorepo's own guidance (the package list, the four-tier hierarchy, gateway modules, changeset rules, tests/e2e policy suites). So every consumer repo's assistant is told it is working on n-dx: wrong context at the top of every prompt, paid for on every turn (a fresh repo got a 261-line CLAUDE.md and a 330-line AGENTS.md).\n\n**Overwrite.** writeClaudeMd (packages/core/claude-integration.js) and writeAgentsMd (packages/core/codex-integration.js) call writeFileSync on the whole file, so a project's own CLAUDE.md or AGENTS.md is replaced on init and on every re-init. The \"do not edit manually\" header leaves a project nowhere to put its own guidance.\n\n**README.** generateTargetReadme (packages/core/readme-generator.js) writes README.md when none exists (or README.proposed.md beside one) with placeholder text (\"Source code for the `<name>` project.\") and falls back to \"See LICENSE.\" when no license is known, whether or not a LICENSE file exists.\n\nThe n-dx repository itself keeps generating its own guidance from project-guidance.md, and the drift and alignment tests (tests/e2e/assistant-body-drift.test.js, instruction-alignment.test.js, agents-md-size-budget.test.js) keep holding it. Behaviour change under the 0.9.0 soft freeze: needs a release-note entry (patch changeset for @n-dx/core)."
acceptanceCriteria:
  - "ndx init in a repository that is not n-dx writes CLAUDE.md and AGENTS.md with project-neutral n-dx usage guidance and none of the n-dx monorepo's architecture, gateway or changeset text"
  - "The n-dx repository's own CLAUDE.md and AGENTS.md are still generated from project-guidance.md and the drift, alignment and size-budget tests pass"
  - "Content a project writes outside the init-managed block of CLAUDE.md or AGENTS.md survives init and re-init byte for byte"
  - "ndx init writes no README.md or README.proposed.md unless asked, and a generated README never names a file that does not exist"
touches:
  - "72d599a7-a398-405e-850d-9ae79659b15e"
  - "406b4b7a-eab0-45e0-ba4c-b0b9bc9dc9b9"
priority: "high"
tags:
  - "core"
  - "init"
  - "assistant-assets"
source: "ndx-capture"
---
