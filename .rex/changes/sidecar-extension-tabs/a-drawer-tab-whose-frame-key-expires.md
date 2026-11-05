---
id: "ed2982c1-4e8b-41d9-b027-11c71598f963"
type: "task"
title: "A drawer tab whose frame key expires after loading stays broken with no Reload"
slug: "a-drawer-tab-whose-frame-key-expires"
description: "Scenario: a tab reaches `ready` (iframe loaded), the drawer stays open past the extension's idleStopMinutes without the page making requests (or the hub restarts, or the extension is disabled). The key is dropped; the iframe's next navigation or reload answers the hub's 401 JSON inside the frame, and the panel offers no \"Expired · Reload\" because ExtensionTabPanel only shows it when the probe in openExtensionTab sees 401 (packages/web/src/viewer/components/sidecar-extension-tabs.ts, ExtensionTabPanel). Recovery today: close and reopen the drawer (which remounts it). Reachable from any long-lived drawer session. Verdict should-fix: real, cheap, but the task spec ruled out a postMessage channel so the frame cannot report it.\n\nOptions: (A, recommended) show a small Reload control beside Pop out on a ready tab that re-runs the key request (bump `attempt`); cost a button and a test, no risk. (B) re-request the key when the tab is reselected after expiresAt (the frame POST answers it); cost tracking expiresAt, risk reloading a frame that was still working since the window slides on use."
acceptanceCriteria:
  - "A ready extension tab offers a Reload control that requests a new frame key and reloads the iframe with the new keyed URL"
  - "A test in tests/unit/viewer/sidecar-drawer.test.ts presses Reload on a ready tab and asserts a second frame-key POST and a changed iframe src"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
