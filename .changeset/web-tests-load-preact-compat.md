---
"@n-dx/web": patch
---

Test-only: every web test file now loads `preact/compat`, as the shipped viewer does, so a test's DOM events no longer depend on which file ran before it in a shared worker. The add-item form blur test and the throttle slider test send the events the viewer listens for. No runtime change.
