---
id: "f8e698df-c2d9-462f-ba04-84e2e8395907"
type: "task"
title: "Address move-file issues (2 findings)"
slug: "address-move-file-issues-2-findings"
description: "- File \"packages/web/src/viewer/messaging/call-rate-limiter.ts\" is pinned to zone \"Viewer Message Pipeline\" but lives in packages/web/src/viewer/messaging/ — consider moving to packages/web/tests/unit/viewer/ to align physical location with architectural zone\n- File \"packages/web/src/server/domain-gateway.ts\" is pinned to zone \"Web Dashboard\" but lives in packages/web/src/server/ — consider moving to packages/web/tests/unit/viewer/ to align physical location with architectural zone"
priority: "high"
source: "sourcevision"
---
