---
"@n-dx/lang-php": patch
"@n-dx/lang-kit": patch
---

Internal: the PHP pack exports `extractPhpEmbeddedSql`, which reads table names from SQL passed to PHP query and prepare calls through lang-kit's SQL reference extractor, like the Java and Go packs' readers. Nothing is written to an analysis artifact.
