---
id: "1312498d-c10e-4374-9884-d808148b89cd"
level: "feature"
title: "Stack the dashboard's floating notices and status pills like toasts instead of overlapping"
status: "pending"
priority: "medium"
source: "ndx-capture"
acceptanceCriteria:
  - "Every bottom-right floating notice renders inside a single shared stack container; no notice keeps its own position: fixed bottom/right offset"
  - "Notices stack vertically, each above the previous one, and never overlap one another, whatever combination is visible"
  - "Transient toasts (the refresh, rex, audit, workflow-optimization and hench-template toasts) are all dismissed after the same duration, taken from one shared constant"
  - "Persistent pills (running operations, uncommitted files, sessions, refresh queue, polling suspension) stay in the stack while their condition holds, and their popovers still open without covering another notice"
  - "When a notice leaves, the stack closes the gap; the stack stays clear of --bottombar-h and fits at phone width"
  - "Screen readers still announce new toasts (role=\"status\" / aria-live kept); the full web suite passes"
description: "The persistent status pills (running tasks/operations, uncommitted files, sessions, refresh queue) share one horizontal status-dock row at the bottom right. Every other floating notice fixes itself at its own bottom offset outside that dock. Those notices are the \"Data updated\" refresh toast, the polling-suspension indicator, and the rex, audit, workflow-optimization and hench-template toasts, and they overlap the dock and each other. Move all of them into one bottom-right stack where each notice sits above the previous one, like a toast list. Persistent pills stay while their condition holds. Transient toasts share one display duration and the stack closes up when one leaves."
lastModified: "2026-10-20T18:16:37.597Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
