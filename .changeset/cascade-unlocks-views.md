---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

The dashboard's Architecture, Problems and Suggestions views now unlock after a cascade analysis. They were gated on generative passes 2–4, which a cascade run never performs even though its single judged pass already produces all of those findings, so they stayed locked however often the project was re-scanned. `zones.json` now records `enrichmentMode`. For files written before that field existed, the dashboard falls back to the manifest's last run mode.
