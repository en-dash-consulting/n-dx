---
id: "c226b635-1423-4093-8c70-50d677a34ba4"
type: "change"
title: "Sidecar on Plan and Tune: entry points, ghost items and one placement surface"
slug: "sidecar-on-plan-and-tune-entry-points"
intent: "Slice S8 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, revision 12, section 4d; decisions SP2–SP8). Built on the Sidecar stack (#901 M1 … #954 X1, C1 connections, C2 tracker sync), and hidden while web.sidecar is off: every Plan and Tune element keeps working without the Sidecar.\n\n- One placement decision surface at a time (SP2): while the drawer holds a change's placement card (Place lens, #946), S7's candidate panel shrinks to one line (\"Placing with Sidecar · decide in the drawer\") and the spec map follows the card's selected row, both ways; \"Place by hand\" reopens the panel with the card's selection, which also covers M1's 60 s card withdrawal.\n- With web.sidecar on, \"Place with Sidecar\" replaces \"Draft with the model\" (SP3).\n- \"Plan with Sidecar\" beside Preview on the capture bar opens the Plan lens with the typed text (SP4).\n- While a change-set card waits, its items show everywhere a change appears: the tree (UX5, as today), Open changes rows, map markers, and a \"+N waiting on a card\" note in the strip; real counts never include them (SP5).\n- A new `area` page item: the area view attaches with Explain by default (the server's Explain packet already handles areas), and \"Plan in this area\" switches to the Plan lens targeted at the area (SP6).\n- \"Tighten with Sidecar\" on Specs to tighten and \"Describe in Sidecar\" on Open changes rows open Describe on that change.\n- Tune (SP7): R1's verdict chips on failed runs, \"Diagnose in Sidecar\" (Diagnose run lens), the Sidecar bucket in Spend, and the Sidecar's settings plus C1's connections in Your tooling.\n- Tracker links from C2 show as chips on change rows, with \"Create in tracker\" through C1's form card; sync activity stays on Live (SP8). This part waits on C2.\n\napply_change stays an operator action in Plan: no lens offers it."
acceptanceCriteria:
  - "With web.sidecar off, none of these controls render and Plan and Tune behave as without the Sidecar"
  - "While the drawer holds a change's placement card, the candidate panel shrinks to one line and the map and the card select each other"
  - "Place with Sidecar replaces Draft with the model when web.sidecar is on"
  - "Plan with Sidecar on the capture bar opens the Plan lens with the typed text"
  - "A waiting change-set card's items show in Open changes, on the map and as a strip note, and never in the real counts"
  - "The area view attaches as an area item with Explain, and Plan in this area switches to the Plan lens"
  - "Tune shows verdict chips on failed runs, Diagnose in Sidecar, the Sidecar spend bucket, and the Sidecar and connections in Your tooling"
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
  - "fdc6c3d4-34f6-4805-8473-a4e672582582"
priority: "medium"
tags:
  - "web"
  - "dashboard"
  - "plan-page-redesign"
  - "sidecar"
  - "tune"
source: "ndx-capture"
blockedBy:
  - "464a9480-8e07-49cd-9889-21d2ae55f316"
  - "99692891-d095-469e-aa09-1725b77e87de"
  - "17be629f-ce13-4dc1-bc14-8685f486342f"
---
