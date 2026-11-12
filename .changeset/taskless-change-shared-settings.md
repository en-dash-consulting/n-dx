---
"@n-dx/web": patch
---

The dashboard's `Start` and `Prepare task` controls save run settings for changes without child tasks.

One-click Start saves project defaults before launching, while existing saved settings and version-conflict checks remain intact. Changes containing tasks direct you to save settings on those tasks.
