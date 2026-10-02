---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

A running analysis now refreshes its progress file every 15 s, and a `running` file not refreshed for two minutes reads as interrupted even when its pid is alive and its command line cannot be read (Windows, no `ps`). Stop on /live/analyze refuses such a file on every platform.
