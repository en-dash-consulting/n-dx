---
id: "4545f02c-3b88-47be-b2e6-1ee9c289e336"
type: "change"
title: "The product map is ready to try in any repo: the next free port when 5188 is held, a graview dir that ignores itself, and the /ndx-graview skill"
slug: "the-product-map-is-ready-to-try-in-any"
intent: "Release readiness for trying the product map in other repositories: a second checkout's face collided on port 5188, a project initialized before the projection existed could commit its graview dir, and nothing ran the check-serve-walk loop for you. Carried over from the v1 item ebabb9f7 when #732 was restacked onto the v2 stack (#972-#977). Ported to the graview-face extension design (880364ecf): the face.json record, the dashboard's Product map link and Start map, and features.graview.productFace are dropped, because the hub now runs the face as an extension; a hub-run face has no project binding yet, so a dashboard link would land on its instruction page."
acceptanceCriteria:
  - "Without --port the face takes 5188 or the next free port; a port --port names, or the hub assigns, is insisted on"
  - "Every emit writes a .gitignore of * in the graview dir"
  - "The /ndx-graview skill ships to Claude and Codex, is read-only, and runs info, check, a background serve and a walk of the face's pages"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "high"
source: "pr-stack:#732 (v1 item ebabb9f7)"
---
