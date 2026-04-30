---
id: "cc28dcfc-04e3-4ff4-8868-8e6f5c910c37"
level: "task"
title: "Address relationship issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-09T22:45:39.523Z"
completedAt: "2026-03-09T22:53:07.894Z"
resolutionType: "code-change"
resolutionDetail: "Moved request-dedup.ts from src/shared/ to src/viewer/messaging/ to resolve the dependency inversion (utility zone importing from consumer zone). Updated all imports, external.ts gateway, and documentation. The triangular import pattern is broken, the ungated inbound surface is eliminated, and artificial cross-zone edges from web-viewer-messaging will dissolve on next analysis."
acceptanceCriteria: []
description: "- Triangular import pattern: message → web-dashboard (3), message → web-viewer (2), web-viewer → message (4). Not a cycle today, but a single new message→web-server import would close the loop and create a critical circular dependency between three zones.\n- viewer-message-pipeline imports 3 times into web-dashboard (message → web) with no gateway enforcement, creating an ungated inbound surface. If those imports reach internals rather than public barrel exports, this is a leaky abstraction.\n- The 2 artificial cross-zone edges from web-viewer-messaging into web-dashboard are inflating the web cluster's apparent coupling density — resolving the zone pins will reduce the total counted cross-zone import edges in the web subsystem by at least 2, giving a cleaner picture of the true web-server/web-viewer boundary"
recommendationMeta: "[object Object]"
---
