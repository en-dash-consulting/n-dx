---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Under bubblewrap on Linux, a confined test runner now nests inside its gate's validation slot and waits for a live holder instead of taking the slot from it.

bubblewrap gives the confined command its own PID namespace, where the holder's pid outside it looked dead. A gate's runner then queued behind its own gate, and an agent shell with no token removed a live holder's record and ran beside it. Each slot record now names the PID namespace it was written in, and the sandbox tells the confined command which namespaces enclose it. A holder outside the reader's namespace, or in a sibling sandbox, is never judged dead. One inside it is judged by its pid there. Seatbelt on macOS, and records written by earlier versions, keep the plain pid check.
