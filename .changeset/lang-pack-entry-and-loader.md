---
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-java": patch
"@n-dx/lang-go": patch
"@n-dx/sourcevision": patch
---

Java and Go analysis now comes from the `@n-dx/lang-java` and `@n-dx/lang-go` packs, which sourcevision loads at run time: first from the per-user pack directory (`<ndx home>/packs/<sourcevision version>/`), then from the normal install. A pack must match sourcevision's version. Without the Java pack, Java files get inventory only and one notice names the install command (`npm install --prefix <pack dir> @n-dx/lang-java@<version>`); without the Go pack, Go imports come from the regex parser. `@n-dx/lang-kit` adds the pack entry type (`LanguagePackEntry`) and the embedded-SQL table reader.
