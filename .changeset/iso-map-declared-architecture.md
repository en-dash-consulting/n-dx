---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
---

The isometric map can now show the two things an import graph structurally cannot: injection seams and runtime infrastructure.

**Injection seams.** A callback or event seam runs the opposite way at runtime from the import that static analysis sees, so the map used to draw an arrow that was backwards for the behaviour people care about. Seams declared under `sourcevision.isoMap.injectionSeams` in `.n-dx.json` are now drawn in the runtime control-flow direction, in a distinct colour, with a panel listing the injected callbacks and stating plainly that the relationship was declared rather than inferred. `from`/`to` accept a zone id, a file path or a directory prefix.

**Runtime infrastructure.** Queues, buckets, caches and databases have no import signature at all. Terraform `resource` blocks are now scanned and classified, and anything IaC does not cover can be declared under `sourcevision.isoMap.infrastructure`. Both render as a trailing column, attributed to the zones whose source names them — weaker evidence than an import, and the panel says so. Resource types with no architectural meaning (IAM roles, security groups) are skipped, and names too short or too generic to match on are refused.

A declaration that cannot be drawn — both ends inside one zone, or naming a file no zone owns — is reported in the page footer rather than silently dropped.
