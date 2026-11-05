---
id: "1adb4370-bc12-4322-9e21-e375e70e2131"
type: "change"
title: "Sidecar extension tabs"
slug: "sidecar-extension-tabs"
intent: "Batch X1 of the Sidecar epic (CAOS 3f7a80b7-1924-8104-9ed8-c98bc5f409e4; story 50 under Sidecar integration, story 51 under Sidecar drawer), stacked on H1 (change 73f42fbb, PR #948). Spec: Sidecar design §17 (extension tabs in the drawer). An enabled extension declares one drawer tab in its manifest (sidecarTab); the hub reports it per project and serves it only through a short-lived frame key carried in the base path (/x/<name>/~f/<key>/), and the Sidecar drawer shows it as an iframe tab sandboxed without allow-same-origin, after the conversation tab. Decided (XT1-XT5, for Hal to confirm in the PR): sidecarTab sits next to projectLinks under apiVersion 1 and needs the sidecar block; the frame key belongs to the proxy; a key is bound to one extension, expires after the extension's idleStopMinutes without use (sliding) with a hard cap, and is dropped on disable, remove, revoked approval or hub restart; no tabs while web.sidecar is off; no tab for a disabled, unapproved or incompatible extension. The pop-out opens the same keyed URL, and every keyed response carries a CSP sandbox header so the page has an opaque origin even full-window. No postMessage channel in v1. The hub-home drawer gets no tabs in v1."
acceptanceCriteria:
  - "Stories 50 and 51 of the Sidecar design (§17, extension tabs in the drawer) are complete"
  - "Nothing in this change turns on web.sidecar; with it off there is no drawer and no extension tab"
  - "An extension page never runs same-origin with a dashboard or the hub: the frame key is accepted only on its own extension's /x/<name>/~f/<key>/ paths, and the tab iframe and keyed responses are sandboxed without allow-same-origin"
  - "src/hub/ imports nothing from src/server/ or src/viewer/, and no gateway export or ceiling raise is added for the frame key: the hub sends the finished keyed URL"
amends: [{"target":"3a95f9ce-cc60-4ca1-a2f9-89cdbfc7f14d","delta":"modified","summary":"Extensions can declare a Sidecar drawer tab served through a scoped frame key","criteria":{"add":[{"id":"drawer-tab","text":"An enabled extension may declare one Sidecar drawer tab; the hub serves it only through a frame key accepted on that extension's own /x/<name>/ paths, and the page never runs same-origin with a dashboard or the hub."}]},"base":"4aa0dcb757524d4e36cc1c33b1710bbf8aebe7d1ea7fe0e7bac16bc62fa6d235"}]
priority: "high"
source: "caos"
---
