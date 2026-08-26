---
"@n-dx/core": patch
---

The skill bodies' POSIX timestamp example works on BSD date now.

Every recording skill's first step named `date -Is` as the POSIX example — GNU-only. On macOS (BSD date), the platform this project is primarily developed on, it exits 1 with `invalid argument 's' for -I`. All 18 skill-body copies now prescribe `date -Iseconds`, valid on both GNU and BSD date, and `tests/e2e/skill-run-recording.test.js` rejects the bare form so it cannot return (with the lookahead that keeps `date -Iseconds` itself legal).
