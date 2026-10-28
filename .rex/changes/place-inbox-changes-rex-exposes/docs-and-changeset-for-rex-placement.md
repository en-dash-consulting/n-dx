---
id: "4751430d-3aa0-4d1b-b637-94b53d7caf1a"
type: "task"
title: "Docs and changeset for rex placement exports and proposals"
slug: "docs-and-changeset-for-rex-placement"
description: "Document `rex change place --propose` and the `place_change` propose option where `rex change place` and `place_change` are documented today (README command reference, docs/ guide pages, the rex MCP tools list in the root guidance source `packages/core/assistant-assets/project-guidance.md` if place_change is listed there; re-run `ndx init` only for instruction files and keep only those, since init also re-runs analyze). Add a changeset bumping @n-dx/rex and @n-dx/hench as patch, using the scoped names. Run the required tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js."
acceptanceCriteria:
  - "Docs describe --propose and the propose option with an example"
  - "A changeset bumps @n-dx/rex and @n-dx/hench as patch"
  - "tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js pass"
priority: "medium"
tags:
  - "inbox-placement"
  - "docs"
source: "ndx-capture"
---
