---
id: "86c5b9cc-d8b4-4a63-8a4a-4dea6fdc5640"
type: "change"
title: "Dashboard logs repeated 403s from the sidecar command status check"
slug: "dashboard-logs-repeated-403s-from-the"
summary: "The dashboard keeps asking for a status it isn't allowed to read and logs an error each time. Stopping those failed requests cleans up the console and hides no real errors."
intent: "Seen in both screenshot runs (integration/plan-analyze-stack and fix/plan-analyze-ui-polish): the browser console shows repeated 403 responses, at least from `/api/commands/sidecar-command/status`. The cause is not yet known: it could be a token the request omits, a route that refuses this caller, or a poll that should not run in this mode (for example with `--no-auth`)."
acceptanceCriteria:
  - "The cause of each repeated 403 on the dashboard is identified and named in the fix"
  - "A normal dashboard session (with and without auth) logs no repeated 403s"
  - "A test covers the request that used to be refused"
touches:
  - "1a326041-9ce2-490e-80ae-55fbdaf81543"
priority: "low"
source: "ndx-capture"
---
