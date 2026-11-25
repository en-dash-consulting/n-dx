---
"@n-dx/sourcevision": patch
---

`sv workspace --add a --add b ws` now writes the members into `ws`'s config. It used to take `a`, the value of the first `--add`, as the workspace root. The command now reads its `--add` and `--remove` values first (in both the `--add a` and `--add=a` spellings), and the one argument left over is the root. A new `--root=<dir>` option names the root explicitly. Two leftover arguments, or a `--root` that names a different directory from the leftover argument, are refused with an error naming both, and nothing is written. `sv workspace --help` documents the argument order.
