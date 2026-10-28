---
"@n-dx/web": patch
---

The Sidecar drawer has an agent picker: vendors and models come from `/api/llm/catalog`, and a new session is created with the chosen vendor and model. Picking another vendor or model on an open session starts a new session and leaves the old one resumable. Tool calls draw collapsed with their name and a one-line summary, and expand to the raw input and the matching result.
