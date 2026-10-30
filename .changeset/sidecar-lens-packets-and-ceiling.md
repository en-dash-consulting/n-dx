---
"@n-dx/web": patch
---

Sidecar sessions gain lens packets and a context ceiling, still behind `web.sidecar`. The Explain, Describe and Plan lenses each build a bounded, deterministic context packet in code (8k, 8k and 10k characters, every section stamped with its source and staleness). A turn that ends above `web.sidecarContextCeiling` (100k tokens for worktree sessions, 40k for the hub) checkpoints: the agent writes typed notes to the session ledger, and the next turn starts fresh from the packet, the ledger and the last two exchanges.
