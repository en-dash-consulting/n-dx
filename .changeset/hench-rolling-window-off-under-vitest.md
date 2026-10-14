---
"@n-dx/hench": patch
---

Hench's rolling output window is off by default under vitest, so agent output reaches a test runner through `console.log` rather than raw `process.stdout` writes it cannot attribute to a test. A test that needs the window opts in with `_overrideTTY`.
