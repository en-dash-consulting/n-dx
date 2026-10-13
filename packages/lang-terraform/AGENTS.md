## lang-terraform

`@n-dx/lang-terraform` is the Terraform pack: the pinned tree-sitter-hcl grammar and Terraform structure; the resource model comes next.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Loaded, never imported.** sourcevision finds this package at run time and imports it dynamically; nothing imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** Its one export is a pack entry whose output is lang-kit's `FileFacts`; no tree-sitter type crosses into sourcevision.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

The code arrives in the tasks of the parser-runtime feature under the language-packs epic; until then this package holds a placeholder export.
