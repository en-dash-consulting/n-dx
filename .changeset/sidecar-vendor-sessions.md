---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

llm-client gains resumable multi-turn vendor CLI sessions (`startVendorSession`, `resumeVendorSession`: start, sendTurn, interrupt, end and resume on the Claude and Codex CLIs, each turn emitting RuntimeEvents with token usage). The per-vendor resume and fork argv, output parsers and session-id capture moved out of hench's CLI adapters into llm-client's session drivers, which the adapters and the fork strategy now build on; hench's behaviour is unchanged.
