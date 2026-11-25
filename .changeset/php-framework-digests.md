---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack needs less memory for config reads, flag checks, outbound calls and legacy constructs, so large PHP repositories fit in a smaller heap.

Each file's config, outbound and legacy captures are now read as the file is parsed and released, as dynamic code's already were; what depends on the whole repository (constants, declared functions, settings files) is resolved afterwards. On 20 MB of generated PHP with every kind, the smallest heap that completes fell from 992 MB to 704 MB. Facts are unchanged.
