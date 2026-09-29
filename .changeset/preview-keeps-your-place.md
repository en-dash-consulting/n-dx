---
"@n-dx/web": patch
---

Preview editor: editing no longer scrolls you back to the top. Re-renders restore both scroll containers and the focused control, selecting a view updates only the highlight and the page instead of rebuilding the rail, and a change to the layout file on disk is swapped in place rather than reloading the page. The preview server also stops injecting its reload poller into a document that already watches `/__preview/state` — the two together were what turned every save into a full reload.
