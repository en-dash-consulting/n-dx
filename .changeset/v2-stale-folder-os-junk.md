---
"@n-dx/rex": patch
---

A v2 write that turns a product folder node into a leaf, or removes it, now deletes OS junk the folder holds (`.DS_Store`, `Thumbs.db`, `ehthumbs.db`, `desktop.ini`) with its tree files, so the folder goes. Before, such a file kept the folder alive with no `index.md`, and every later read warned about it. Any other dot entry there (`.gitkeep`, `.notes/`) now refuses the write, naming it, like other non-tree files.
