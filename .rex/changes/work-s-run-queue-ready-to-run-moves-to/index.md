---
id: "f9674fd9-5721-4da7-b9f5-891b633b352a"
type: "change"
title: "Work's run queue: Ready to run moves to Tune, a queue panel beside Running now, and a copy on Preparation"
slug: "work-s-run-queue-ready-to-run-moves-to"
summary: "Lets you line up the tasks the agent should run next, in your order, from Work and from Plan's Preparation. The full Ready to run list moves to the top of Work's Tune page, and Work's Now page shows what is running beside the queue."
intent: "From reviewing the Plan/Work redesign. Today Work › Now shows Running now and Ready to run, and ndx work always takes rex's own next pick. The queue is a planned, ordered list saved on the server and shared by both pages: ndx work takes its first item next, before its own pick, and nothing starts until a run is free. Ready to run (with its mine/unassigned split and filters) moves to the top of Work › Tune, where items can be added to the queue."
acceptanceCriteria:
  - "Work › Now shows Running now beside a Queue panel, and no longer shows Ready to run"
  - "Work › Tune opens on Ready to run"
  - "Plan › Preparation shows the same Queue panel, reading and writing the one queue"
  - "ndx work runs the queue's first item next, before its own pick"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
discoveredFrom: {"item":"ede1af70-6110-418a-b91d-536149a008b4"}
source: "ndx-capture"
---
