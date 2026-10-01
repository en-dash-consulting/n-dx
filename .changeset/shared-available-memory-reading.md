---
"@n-dx/llm-client": patch
---

Add a shared available-memory reading (`readAvailableMemory`, `getAvailableMemory`).

On macOS it counts free + inactive + speculative + purgeable pages from `vm_stat` and takes health from `kern.memorystatus_vm_pressure_level`, instead of `os.freemem()`, which counts only free pages and read a healthy 16 GB Mac as ~115 MB free. When neither can be read the reading is `availableBytes: null` and `pressure: "unknown"`, never 0. Linux and Windows keep `os.freemem()` unchanged. Readings are cached for 5 s and concurrent refreshes share one spawn.
