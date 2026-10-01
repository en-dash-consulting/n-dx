---
id: "eb632a9e-d324-486a-a21c-5366b1732293"
level: "feature"
title: "Dashboard request hardening"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "request-hardening"
source: "0.8.0 request hardening (2026-10-01)"
acceptanceCriteria:
  - "The hub and a directly started project server both refuse a request whose Host is not localhost, 127.0.0.1 or [::1] on their own port, for every method, before any route runs."
  - "Requests through the hub to a project, the ndx CLI and MCP clients keep working unchanged."
  - "No GET route writes to the project directory."
  - "SECURITY.md exists at the repository root and names a private reporting route."
description: "The hub (port 3117) and each project's dashboard server bind to 127.0.0.1 and judge browser requests by their Origin header, but they accept a request whatever Host header it carries. This feature makes both reject any Host that is not a loopback name on the port they serve, removes the one GET route that writes a project file, and adds a security policy so problems can be reported privately.\n\nGoal: The dashboard and hub answer only requests addressed to them by their own loopback name, no read-only route changes project files, and reporters know how to raise a security problem privately."
lastModified: "2026-10-01T15:48:24.259Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a SECURITY.md with a private reporting route](./add-a-security-md-with-a-private.md) | pending |
| [Stop GET /api/ndx-config from writing .n-dx.json](./stop-get-api-ndx-config-from-writing-n.md) | pending |
| [Validate the Host header on hub and dashboard server requests](./validate-the-host-header-on-hub-and.md) | pending |
