---
"@n-dx/sourcevision": patch
---

A missing Terraform, Java or Python pack that the project does not list in `sourcevision.packs` no longer prints a per-language warning. Instead, analyze prints one line at the end naming every such pack: `Optional packs for this repo: … — ndx sv pack add <id>`. A listed-but-missing pack, or one that is refused, invalid or fails while running, still gets a warning. A missing Go pack still warns. Analysis output does not change.
