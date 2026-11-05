---
id: "a6f9250c-903e-43c0-af9a-bbeb0692d5b9"
type: "task"
title: "Sidecar sessions take a target and can be renamed or re-lensed, and the packet opens the first turn"
slug: "sidecar-sessions-take-a-target-and-can"
description: "Server work for stories 09 and 10, so those are UI only. M1 builds the lens packet only on a context-refresh turn, with an empty target. CAOS stories: https://www.notion.so/3f7a80b7192481fea2d1d0effbc05cec, https://www.notion.so/3f7a80b719248161bde1f381bd30e8ee."
acceptanceCriteria:
  - "PATCH /api/sidecar/sessions/:id accepts name, lens and target, each optional, and is refused while web.sidecar is off (tested)"
  - "POST /api/sidecar/sessions accepts target (tested)"
  - "The session record keeps target across a server restart (tested)"
  - "The lens packet built for the session target goes with the first turn as well as a context-refresh turn (tested)"
  - "A test asserts a Describe session on a task sends that task packet on turn one"
priority: "high"
source: "ndx-capture"
---
