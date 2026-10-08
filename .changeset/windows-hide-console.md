---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Child processes no longer open console windows on Windows. The shared `exec`
wrapper defaults `windowsHide` to true, and the core CLI spawn shim, the vitest
launcher and the e2e helpers set it, so a test suite or an agent run no longer
flashes a console per spawn across the screen and steals keyboard focus.
