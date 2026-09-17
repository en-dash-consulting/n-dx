---
"@n-dx/core": patch
---

`ndx work` prints one identity line before handing over to the agent: `ndx <version> · <cliPath> · <projectDir> · <branch>`. A run is the most expensive thing the CLI starts and the hardest to attribute afterwards — the run record says what happened but not which install produced it. The branch is read from the project directory, so it names the checkout the work lands on rather than the one n-dx runs from, and it is dropped outside a working tree. `--dry-run` prints it too; `--format=json`, `--quiet` and `-q` do not, since their output is parsed rather than read.
