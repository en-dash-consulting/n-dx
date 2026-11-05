---
id: "f453e786-c4bb-4f28-b049-3912ce0e02b0"
type: "task"
title: "Tracker link chips on change rows (waits on C2)"
slug: "tracker-link-chips-on-change-rows"
description: "SP8. Once C2 (Sidecar tracker sync) lands: a change linked to a tracker item (C2 story 44) shows a chip with the tracker, item state and a link, on Open changes rows and in the change detail; an unlinked change offers \"Create in tracker\", which raises C1's form card. Tracker sync activity stays on Live. Do not start until C2 is merged into this stack."
acceptanceCriteria:
  - "A linked change shows a tracker chip with state and link on its row and in its detail"
  - "Create in tracker raises C1's form card and writes nothing until approved"
  - "Without a connection the chip and action do not render"
priority: "low"
source: "ndx-capture"
---
