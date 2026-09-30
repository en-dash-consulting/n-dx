---
"@n-dx/web": patch
---

Dashboard: add the shared settings frame (explicit Save, dirty indicator, leave guard).

`viewer/components/settings-frame.ts` is the frame the three consolidated
settings pages (Robot Wrangler, Workflow, Project) will render inside. It is
controlled: a page hands it `dirty`, `saving`, `error` and `onSave` (plus an
optional `onDiscard`), and the frame renders the page's fields, an explicit
Save button disabled while clean or saving, and an unsaved-changes indicator.

A new `viewer/hooks/use-leave-guard.ts` blocks every way of leaving a dirty
frame — switching overlay entries, closing the overlay (✕/Escape), any
`navigateTo`/`handleSidebarNav` call, and browser back/forward — behind an
in-app "Keep editing / Discard changes" prompt, and arms `beforeunload` only
while dirty. Back/forward can't be cancelled, so a blocked pop re-pushes the
settings URL and only applies the popped navigation on Discard.

No existing settings view adopts the frame yet — that lands with the three
page tasks.
