---
"@n-dx/core": patch
---

Stop a directory from shadowing a config key in `ndx config`

`n-dx config [dir]` and `n-dx config <key>` occupy the same positional slot, and
the tie was broken by asking the filesystem: if the argument named something that
existed, it became the directory. In a project that happened to contain a
subdirectory named after a config section, that silently discarded the key —
`ndx config hench` in a project with a `hench/` directory read the config of
`./hench`, found none, and reported a fully-initialized project as uninitialized.

A known key now wins, because a key is an exact match against a closed set
(`PROJECT_SECTIONS`, the package names, and `language`) while a directory name is
arbitrary. `./hench` and `../hench` still unambiguously mean the directory: their
first dot sits at index 0, so the root segment is empty and never matches a
section. A positional that is not a known key is resolved as a directory exactly
as before, so `ndx config ./some/project` is unaffected.
