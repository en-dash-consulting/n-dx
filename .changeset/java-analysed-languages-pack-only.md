---
"@n-dx/sourcevision": patch
---

inventory.json's `analysedLanguages` lists Java only when the Java pack ran. Without `@n-dx/lang-java` a Java repository no longer reports Java as analysed while imports.json has no Java edges, and an imports-only re-run (`sv analyze --phase=2`) after the pack is removed drops it.
