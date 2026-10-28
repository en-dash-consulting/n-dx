---
"@n-dx/core": patch
---

Add extension discovery: find `ndx.extension` packages in the project, the user extensions folder (`<ndx home>/extensions`), the global install and `extensions.paths` dev checkouts, in that precedence. Only `package.json` files are read. A package found in several sources keeps the highest copy and names the others; two packages claiming one name are both refused. Results are cached in `<ndx home>/extensions.json` and recomputed when a source folder changes.

Linked manifests are watched even before they declare an extension, and cache entries stay project-bound without replacing approval or disable state. Global package-manager paths are compared through symlinks on macOS and Windows.
