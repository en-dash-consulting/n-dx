---
id: "42a34384-e328-4c95-8db3-0a96e385b874"
type: "change"
title: "An approved CAOS create links the change through a URL the profile builds from the item id"
slug: "an-approved-create-whose-reply-names"
intent: "Ryan's decision (2026-11-05): real CAOS work items carry only an opaque UUID id (checked read-only through the caos connector: list_work_items/get_work_item return id like 3b3a80b7-1924-80f7-b5fc-e8093ba5f7f0, no WM-style key, no URL field). So changeItemLink, which accepts a tracker key or an http(s) URL (link-refs.ts normalizeWorkRef), refuses every real CAOS create and the change stays unlinked (found in the review of 57bf05e3, run 06531dfc). Fix: the tracker profile builds a URL from the item id. Add an optional profile property (e.g. tracker.itemUrlTemplate in profiles/caos.json, with placeholders for the id as given and the id without dashes); CAOS items are Notion pages, so the CAOS template is the Notion page URL. When a create reply's id is not already a key or URL and the profile has a template, link the change to the built URL, which the existing link rule accepts. Do not widen normalizeWorkRef or the v2 issues contract. Without a template, keep today's behaviour: the entry records the created item and names the link problem. The chip then links to the item through that URL."
acceptanceCriteria:
  - "Approving a CAOS create whose reply carries only an opaque id links the change to the URL the profile builds from that id, and the entry names no link problem"
  - "A profile without an item URL template keeps today's behaviour: the entry records the created item and names the link problem"
  - "normalizeWorkRef and the v2 issues contract are unchanged"
  - "A sync-engine test against the fake CAOS server with an opaque-id create reply asserts the change's issues hold the built URL, and a later run-started event plans a move for that work item"
touches:
  - "7df16224-db25-4a39-81d2-5c5c3904f4b9"
priority: "high"
discoveredFrom: {"item":"57bf05e3-a8f3-4d56-a411-244eb842492e","run":"06531dfc-99a5-472d-aa2f-bc25f5d09755"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
