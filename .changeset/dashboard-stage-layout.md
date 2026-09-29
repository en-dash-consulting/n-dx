---
"@n-dx/web": patch
---

Dashboard layout: the sidebar is replaced by the layout prototyped in the preview demo.

- **Top bar:** the logo and project name (which take you home) and three stage tabs — Analysis, Plan, Work — plus search.
- **Landing page** at `/home`, now the default: the three stages as columns side by side, each with its product mark, a line on what it is for, and its headline numbers from `/api/status`.
- **Stage pages** at `/analyze`, `/plan`, `/work`: each composes the existing views as collapsible sections, mounted only while open, with an "Open" link to the view's own page. The import map's 2D and isometric 3D views share one section behind a toggle. PRD progress and the execution log sit on Work; CLI help sits above run history on Plan.
- **Side stage links** on every staged page step around the loop, Analysis → Plan → Work → Analysis.
- **Bottom bar:** server identity, a settings cog, per-stage status badges, a System · Light · Dark theme control (System is the default and follows the OS live), help, and a Commands button that lifts the command reference over the page.
- **Settings** open as a full overlay with a ✕, over the page you were on.

Every existing view keeps its route and deep links (`/zones`, `/prd/<id>`, `/hench-runs/<id>`); the tab of the stage that lists a view stays lit on its page. Fixed-position toasts and trays are lifted clear of the bottom bar.
