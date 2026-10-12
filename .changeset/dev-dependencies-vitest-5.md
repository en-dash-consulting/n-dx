---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Dev dependencies bumped, including vitest 5. No runtime change: the published packages ship the same code, and the one test that vitest 5 rejected (a `vi.mock` written inside a test body) now declares its mock at module scope.
