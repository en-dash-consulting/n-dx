---
"@n-dx/lang-php": patch
"@n-dx/lang-runtime": patch
---

`ndx analyze` with the PHP pack reads dynamic code in a fraction of the memory, so large PHP repositories no longer run out of heap.

Each file's dynamic-code captures are now read as the file is parsed and released, keeping only its sites and a compact form of its database flow. On 20 MB of generated PHP the dynamic-code run needed over 2 GB of heap before and fits in 768 MB now; every kind together fits in 1 GB. Facts are unchanged. A file with more than 500,000 syntax nodes to read for dynamic code (generated data) is skipped with a `[php-dynamic-skipped]` notice naming it, instead of risking the whole analysis.

For pack authors, a lang-runtime `FrameworkPack` may declare `digest(file, kinds)`, called as each file is parsed; its own queries' captures are then dropped from the file and `read` receives the digests by path.
