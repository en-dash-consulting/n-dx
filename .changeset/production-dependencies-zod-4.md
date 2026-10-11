---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Production dependencies bumped: zod 4, ink 8, react 19.3, @anthropic-ai/sdk 0.131, @modelcontextprotocol/sdk 1.32.1 and pdfkit 0.20. TypeScript stays on 6.x because sourcevision parses source with its compiler API, which TypeScript 7 does not ship, and preact stays on 10.x until its web test and leave-guard changes are worked through. Schemas move to zod 4's two-argument `z.record`; reserved and loosely-typed state keys are declared optional, since zod 4 no longer treats a missing `z.unknown()` key as optional; and the SDLC evidence list keeps its at-least-one rule as a tuple so it still infers the non-empty type.
