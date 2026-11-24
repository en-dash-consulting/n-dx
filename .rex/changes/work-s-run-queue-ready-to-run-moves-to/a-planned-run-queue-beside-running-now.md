---
id: "675b30df-e80b-47db-b8fb-9d739ea57cc8"
type: "task"
title: "A planned run queue beside Running now that ndx work takes next"
slug: "a-planned-run-queue-beside-running-now"
summary: "A Queue panel next to Running now on Work's Now page lets you line up ready tasks in the order you want them run; the agent takes the first one next instead of its own pick, and nothing starts until a run is free."
description: "A server-side ordered queue of task ids per project (stored as hench tool state, read and written through new web routes), shown as a Queue panel beside Running now (Running now and Queue share the row). Add from a Ready to run card ('Add to queue') or by searching ready tasks in the panel; reorder (up/down, keyboard reachable) and remove. ndx work's task selection takes the queue's first still-actionable item before rex's own pick, and removes it once its run starts; an item that is no longer actionable (completed, deleted, blocked) is dropped with a note. Concurrency: writes go through the same lock discipline as other hench state."
acceptanceCriteria:
  - "Work › Now shows Running now and a Queue panel side by side"
  - "Ready tasks can be added to the queue, reordered and removed, from the keyboard as well as the pointer"
  - "The queue is saved on the server, so another browser or a reload sees the same order"
  - "ndx work runs the queue's first actionable item next, before its own pick, and takes it off the queue when its run starts"
  - "An item that is no longer actionable is dropped from the queue with a note"
  - "Unit tests cover the queue routes, the panel, and ndx work's selection from the queue"
priority: "medium"
source: "ndx-capture"
---
