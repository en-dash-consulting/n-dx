---
"@n-dx/sourcevision": patch
---

`manifest.json` now lists the language packs that ran in the analysis, as `packs: [{ id, version }]` sorted by id.

A pack is listed only when it loaded and ran over files of its language: an installed pack with nothing to read, or one that degraded, is left out, and `[]` means no pack ran. Manifests written before the field existed still validate.
