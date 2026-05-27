---
"@n-dx/web": patch
---

Redesign the Rex Tasks view controls and fix scrolling. Replaces the stacked
filter UI with a two-row control bar (search + match count + inline actions on
top, icon-only status pills + tag typeahead below) and collapses the nested
scroll regions into a single bounded scroller so the task list is the only thing
that scrolls.
