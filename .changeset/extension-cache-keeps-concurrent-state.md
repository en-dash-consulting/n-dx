---
"@n-dx/core": patch
---

Extension discovery's cache write re-reads `extensions.json` and replaces only its `discovery` key, so a disable, removal or approval another process wrote during discovery is no longer undone.
