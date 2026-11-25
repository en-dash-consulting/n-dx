---
"@n-dx/core": patch
"@n-dx/sourcevision": patch
---

`ndx analyze` now runs in a repository `ndx init` never touched, and writes nothing outside its own output folder.

The output folder is created where init would put it: `.ndx/sourcevision/`, or `.sourcevision/` beside legacy `.rex`, `.hench` or `.n-dx.json` state. `ndx status`, `ndx work` and the other commands that need init still refuse such a repository.

`sv init` and `sv analyze` no longer append to the project's `.gitignore`. The machine-local `.cache/` is ignored by a `.gitignore` inside the output folder instead, and `sv reset` adds `.backup/` to that file rather than replacing it. Existing projects gain that one file on their next analysis; projects set up with `ndx init` already ignore the cache from the root.

In a repository with no rex or hench state, vendor-CLI calls made during `ndx analyze` are logged to `<output folder>/.cache/claude_commands.log` rather than `claude_commands.log` at the root, unless `NDX_CLI_LOG_PATH` is set. The run no longer reports such a repository as "Project setup incomplete".
