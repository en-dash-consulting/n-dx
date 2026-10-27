---
id: "31fa50b1-31fc-48f3-a311-341ddbd510de"
type: "capability"
title: "ndx add CLI Delegation Fix"
slug: "ndx-add-cli-delegation-fix"
statement: "The `ndx add` and `ndx move` orchestration commands pass their work to the matching `rex` commands. They check for an initialized `.rex/` directory in the project directory the command targets, and they return rex's own results, errors and exit codes."
criteria: [{"id":"c1","text":"When `ndx add \"<description>\"` runs from a directory that contains `.rex/`, the ndx CLI shall pass the command to `rex add` and finish without a missing-.rex error."},{"id":"c2","text":"The ndx CLI shall pass every flag that `rex add` supports, including `--file`, `--accept`, `--parent` and `--manual`, from `ndx add` through to `rex add`."},{"id":"c3","text":"If `ndx add` runs outside an initialized directory, the ndx CLI shall show the same user-friendly error as `rex add` and shall not print a raw stack trace."},{"id":"c4","text":"The ndx CLI shall return the exit code from `rex add` unchanged as the exit code of `ndx add`."},{"id":"c5","text":"When `ndx add` runs against a directory with an initialized `.rex/`, the ndx CLI shall exit with code 0 and print neither a 'missing .rex' message nor a stack trace."},{"id":"c6","text":"When `ndx move <id> --parent=<pid> <dir>` runs from a directory that is not a project, the ndx CLI shall check for `.rex` in `<dir>` and move the item in `<dir>`."},{"id":"c7","text":"When `ndx move` is given no directory argument, the ndx CLI shall check the current directory for `.rex` and shall never treat the item id as a directory."},{"id":"c8","text":"The ndx CLI shall pass the arguments of `ndx move` to `rex move` unchanged, so that rex handles the positional arguments itself."}]
---

Fix the ndx add orchestration command which currently throws a missing-.rex error instead of properly delegating to rex add.
