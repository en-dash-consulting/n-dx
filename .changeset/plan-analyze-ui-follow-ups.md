---
"@n-dx/web": patch
---

Dashboard buttons marked small now render small, Plan keeps its tile order and names while loading, and the console no longer logs repeated 403s from the Sidecar status check.

- Buttons the dashboard marks `btn-sm` (Inbox and placement actions, Apply, the assignee picker, Ask in Sidecar) take the small button size; before, no style backed the class and they rendered full-size.
- On a project still on the v1 PRD layout, Plan lists Describe a change first again, then Tasks and Product, then Plan health.
- Until the project's PRD layout is known, Plan's capture tile shows a loading state instead of flashing "Add Items" and "Generate" on a v2 project.
- The placement diagram's arrowhead is drawn as a clipped triangle; it looks the same in both themes.
- With `web.sidecar` off (the default), the dashboard stops polling `/api/commands/sidecar-command/status`, which that setting refuses with 403, so the browser console no longer fills with failed requests.
