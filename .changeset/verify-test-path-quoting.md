---
"@n-dx/rex": patch
---

`verify --run-tests` now quotes the test paths it appends to the configured test command.

The test command is a shell string by contract, so the discovered paths appended to it were parsed by that shell as well. Those paths are filenames found by walking the repository, and `&` separates commands in both `sh` and `cmd.exe` — so a file whose *name* carried a command ran it on the machine of whoever invoked verify. That reaches further than it first appears: MCP `verify_criteria` defaults `runTests` to true, and the dashboard's requirements view calls the same path, so merely opening a repository and checking coverage was enough. A filename also passes review far more easily than an edit to the configured test command.

Paths are now quoted for the platform's shell — single quotes on POSIX, double quotes under `cmd.exe`. The selected files are unchanged and still passed to the runner; only their quoting differs. A path that quoting cannot make safe is dropped instead of run: `cmd.exe` expands `%VAR%` even inside double quotes, which no quoting closes, and no legitimate test file needs a `%` in its name.
