---
"@n-dx/llm-client": patch
---

Add an OS-level confinement module for agent child processes: backend detection (Seatbelt on macOS, bubblewrap on Linux), profile generation from one policy, and argv wrapping. Not yet wired into hench's spawn paths.
