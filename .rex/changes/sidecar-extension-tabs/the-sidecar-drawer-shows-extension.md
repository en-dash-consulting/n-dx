---
id: "160d553d-6d40-41b0-9a3b-17914361667c"
type: "task"
title: "The Sidecar drawer shows extension pages as sandboxed tabs"
slug: "the-sidecar-drawer-shows-extension"
description: "Story 51 (drawer half; Sidecar design §17.1, needs 50a and 50b). packages/web/src/viewer/components/sidecar-drawer.ts gains a tab strip: Sidecar first, then one tab per extension tab from GET /api/hub/extensions?project=<id>, in the hub's order. Read the list the way components/extension-links.ts reads links (useHubProjects, extensionLinksPath, only hub-mounted /x/ URLs kept), so a dashboard without the hub shows no strip and no extension code enters the bundle. On a tab's first open, POST the frame route for its keyed URL and load it in an iframe with sandbox=\"allow-scripts allow-forms allow-popups allow-downloads\" exactly. While the key request or the page is starting (a cold sidecar start can take up to 20 s) show \"Starting <label>…\"; on the hub's 503 show its error and the log file it names; on 401 show \"Expired · Reload\", which asks for a new key. A pop-out link opens the same keyed URL in a new window. Switching tabs hides rather than unmounts, so neither the frame nor the conversation and composer reload. Viewer code reaches messaging and shared code only through src/viewer/external.ts and src/viewer/api.ts. The hub-home drawer (src/hub/home.ts) gets no tabs in v1. No postMessage channel."
acceptanceCriteria:
  - "The drawer shows a tab strip with Sidecar first, then one tab per extension tab in the hub's order; with no hub, or no tabs, there is no strip"
  - "An extension tab's iframe has sandbox exactly allow-scripts allow-forms allow-popups allow-downloads (no allow-same-origin, no allow-top-navigation), and a test asserts the attribute"
  - "The frame key is requested and the iframe created only on a tab's first open; switching to Sidecar and back keeps the conversation, the composer text and the frame without a reload"
  - "A starting tab shows \"Starting <label>…\"; the hub's 503 shows its message including the log file; a 401 shows \"Expired · Reload\", which fetches a new key; tests cover all three"
  - "A pop-out link opens the tab's keyed URL in a new window"
  - "No extension tab renders while web.sidecar is off, and the hub-home drawer shows no tab strip"
priority: "high"
source: "caos"
---
