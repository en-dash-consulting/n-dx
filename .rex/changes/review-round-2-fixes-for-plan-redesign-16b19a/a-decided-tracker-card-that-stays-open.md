---
id: "213a850b-fd30-4556-8709-f1051742c195"
type: "task"
title: "A decided tracker card that stays open does not refresh its row or chip"
slug: "a-decided-tracker-card-that-stays-open"
description: "Verdict should-fix (low), from the adversarial review of 499952e1. TrackerCardForm (packages/web/src/viewer/components/tracker-card-form.ts, send) now keeps the form open on a refused result or an ok create whose link failed, and calls neither onDone nor any refresh. The server has already closed the card. In Live (live-tracker.ts:81) the row still reads as waiting until the next refreshKey tick, so after Cancel it offers Approve again, which answers 409. On a change row (tracker-chip.ts:152) onCreated never runs, so after an ok create with a failed link the chip keeps offering Create, which is also refused. Reachable through Live's Approve and Plan's Create in tracker. Options: (a) add an optional onSettled prop that the form calls when a result closed the card, with Live passing reread and the chip passing reload. Cheap; the parent may unmount the form, so the problem has to stay visible (render it in the parent, or keep the form's error). (b) Call onCancel plus the refresh on Cancel after a settled result. Recommend (a)."
acceptanceCriteria:
  - "After a refused approval in Live, the row no longer shows Approve once the form is closed, without waiting for the next snapshot"
  - "After an ok create whose link failed on a change row, the chip reloads and no longer offers Create"
  - "A test covers each case"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
