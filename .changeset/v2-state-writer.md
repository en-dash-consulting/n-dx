---
"@n-dx/rex": patch
---

Add the v2 state writer (`store/state-writer.ts`), the one module that reads and writes per-folder `state.yaml`. Output is canonical (fixed key order, LF endings), unknown keys keep their original line byte for byte, writes refuse to run outside the PRD lock, and `revisedAt` is stamped and cleared against `metAt`. The file lock gains `isLockHeld`. v2 is still not wired to the store.
