---
"@n-dx/rex": patch
---

A v2 write that would turn a product folder node into a leaf, or remove it, while its folder holds files that are not part of the tree (`notes.txt`, an image) is refused before anything is written, naming those files. Before, the folder was left behind with no `index.md` and every later read warned about it.
