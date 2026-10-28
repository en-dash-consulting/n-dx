---
id: "ac340adb-639b-40c7-a4fc-84c6e21e7a16"
type: "task"
title: "Docs and changeset for the placement routes"
slug: "docs-and-changeset-for-the-placement"
description: "Document the new routes and the rex.inbox status field where the dashboard's rex API is documented (docs/architecture/web-server.md or the API reference page). Add a changeset bumping @n-dx/web as patch. Run tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js."
acceptanceCriteria:
  - "Docs list the three routes and rex.inbox"
  - "A changeset bumps @n-dx/web as patch"
  - "The two required tests pass"
priority: "medium"
tags:
  - "inbox-placement"
  - "docs"
source: "ndx-capture"
---
