---
id: "27497b67-2342-4c5a-8c85-0a72af85fa25"
type: "change"
title: "A Notion peek URL pasted from a board view reads back as the database id, so its tracker move is refused and settled"
slug: "a-notion-peek-url-pasted-from-a-board"
intent: "Found by the adversarial review of f0c6ea64 (run 2f2299b2). Verdict: should-fix, medium. This gap was left open by that change, not introduced by it: before the change the whole remainder was sent and refused the same way.\n\nScenario: the operator opens a CAOS item from a Notion board, which shows it as a side peek. The browser URL then has the form `https://www.notion.so/<ws>/<dbId32hex>?v=<viewId32hex>&p=<pageId32hex>&pm=s`. `trackerItemIdOfRef` (packages/web/src/server/tracker/server-profiles.ts, `{compactId}` branch) drops the query and reads the trailing 32 hex of the last path segment. That is the database id, not the page id. `planTrackerEvent` (rules.ts:186) sends it as `workItemId`, and `readTrackerItemState` (item-state.ts:41) reads it too. CAOS refuses the id, and a refusal settles the event (sync-engine.ts), so the move is lost.\n\nReachable when that URL is pasted into the dashboard Link control or the Sidecar `propose_link` card.\n\nOptions:\n1. (Recommended) In the `{compactId}` branch, prefer a `p=` query parameter holding 32 hex over the path tail. The change is small and local, and the risk is low because `p` is Notion's page parameter.\n2. Normalise at link time to the canonical built URL (item-links.ts). This option is larger."
acceptanceCriteria:
  - "trackerItemIdOfRef on the CAOS mapping reads 3b3a80b7-1924-80f7-b5fc-e8093ba5f7f0 from https://www.notion.so/ws/0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210&p=3b3a80b7192480f7b5fce8093ba5f7f0&pm=s"
  - "A URL with no p= parameter still reads the id from the path tail (existing unit test stays green)"
touches:
  - "7df16224-db25-4a39-81d2-5c5c3904f4b9"
priority: "medium"
discoveredFrom: {"item":"f0c6ea64-7a37-4826-bc2f-aff8bf813737","run":"2f2299b2-a3d2-49b1-8312-ff01b7406eaa"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
