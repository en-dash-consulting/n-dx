---
"@n-dx/web": patch
---

Run every async dashboard job through one shared job tray.

The tray now tracks all seven background commands — full analysis, refresh,
self-heal, `ndx ci`, reshape, recommend and Project Scan — alongside hench task
executions, each with phase, elapsed time and a working Stop. Every one of
those commands gained a `/stop` endpoint, and `rex recommend` became an async
job rather than a multi-minute synchronous request. A finished run shows a
result card linking to where its output landed.

The per-view pollers those jobs used to run in Commands, Overview and
Suggestions are gone: each view now reads the shared tray, so a job stays
visible and stoppable from any view rather than only the one that started it.
