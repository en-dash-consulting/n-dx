---
id: "90612f02-b6e2-48be-bd17-97ab0541461f"
type: "task"
title: "A manual spec whose dashboard fails to start leaks its fixture directory"
slug: "a-manual-spec-whose-dashboard-fails-to"
description: "Severity: low. Verdict: should-fix (one line).\n\nEach manual spec's afterAll begins with `if (!dashboard) return;`. When createRealVendorProject succeeds but startRealDashboard throws in beforeAll, project is set and dashboard is not, so the temp project under os.tmpdir() is never removed. Fix: guard the dashboard stop on dashboard and the cleanup on project separately (honouring NDX_E2E_KEEP_FIXTURE)."
acceptanceCriteria:
  - "afterAll removes the fixture directory when project is set even if dashboard is undefined"
  - "The attach/stop steps still skip cleanly when no dashboard was started"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
---
