---
"@n-dx/llm-client": patch
---

`exec` takes an optional `onSpawn` callback that receives the child's pid as soon as it starts, and whether that pid is also its process group.

Callers that omit it behave exactly as before. hench uses it to record a test command in the host validation slot.
