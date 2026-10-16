---
"@n-dx/sourcevision": patch
---

An imports-only re-run (`sv analyze --phase=2`) after the Python pack is removed now drops Python from inventory.json's `analysedLanguages`, instead of keeping it from the earlier run with the pack. A full analyze, with or without the pack, writes the same inventory.json as before.
