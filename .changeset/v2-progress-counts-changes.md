---
"@n-dx/rex": patch
"@n-dx/web": patch
---

On a v2 project, progress counts a change with no tasks as one unit of work. A root change used to be counted like a v1 epic, a pure grouping, so an open change with no tasks counted for nothing and the Work page, the home Plan card and the status bar could read 100% while it was open. The Work page's progress panel now says changes rather than epics on v2, and a change with no tasks shows its status instead of 0/0. v1 numbers and labels are unchanged.
