---
id: "24f931c4-2411-44c9-9325-d82e06558159"
level: "feature"
title: "CLI Identity Propagation Across Dashboard"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "The web dashboard currently displays hardcoded 'ndx' command strings in button labels, help text, code snippets, and the new Commands section. This feature exposes the resolved cli.name via the server API, injects it into dashboard shared state, and replaces all hardcoded references so users working in projects with a different command name see accurate guidance throughout the UI."
---

## Children

| Title | Status |
|-------|--------|
| [Expose resolved CLI name via server API and inject into dashboard shared state](./expose-resolved-cli-name-via-396910.md) | pending |
| [Replace hardcoded 'ndx' command references in dashboard UI with project-resolved CLI name](./replace-hardcoded-ndx-command-46ebab.md) | pending |
