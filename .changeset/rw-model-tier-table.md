---
"@n-dx/web": patch
---

Robot Wrangler replaces the agent, project and light model fields with a tier table: one row per tier the server resolved (Agent model, Standard, Light, Heavy, and Free when set), each showing what uses it, a model select and where the model comes from. Heavy and Free save `llm.tiers.<vendor>.heavy` / `.free`; clearing a row removes its key.
