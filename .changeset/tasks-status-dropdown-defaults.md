---
"@n-dx/web": patch
---

Rework the Rex Tasks view status filter and initial state. The status filter is
now a multi-select dropdown showing per-status counts with "View all" and
"Pending only" quick actions. On a fresh load the tree defaults to showing only
pending items when any exist (otherwise all statuses), and the tree now starts
fully collapsed.
