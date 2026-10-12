---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Test-only: the slowest e2e and integration files build their fixture once and copy it per test, or run the CLI once per fixture state and assert many times, instead of spawning the CLI or git per test. Same tests, a third to a half of the wall time. No production code changed.
