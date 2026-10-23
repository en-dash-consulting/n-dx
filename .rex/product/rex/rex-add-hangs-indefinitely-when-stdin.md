---
id: "769fe73d-705f-431d-a342-a745425f06eb"
type: "capability"
title: "rex add hangs indefinitely when stdin is an open pipe"
slug: "rex-add-hangs-indefinitely-when-stdin"
statement: "The rex add command does not read stdin in manual mode, where a level and title are given, so it finishes even when stdin is an open pipe, and it still accepts a piped description in smart mode."
criteria: [{"id":"c1","text":"When `rex add` is invoked with a level and `--title`, the rex CLI shall complete without reading stdin."},{"id":"c2","text":"When `rex add` is invoked in manual mode with an open stdin pipe that never closes, the rex CLI shall exit rather than block."},{"id":"c3","text":"When a description is piped to `rex add` without a level and title, the rex CLI shall read the piped description and use it for smart add."},{"id":"c4","text":"If the rex CLI reads stdin during `rex add`, the rex CLI shall bound that read so the caller cannot hang forever with no output."}]
source: "ndx-capture"
priority: "medium"
---

`rex add task --title=... --parent=... --description=...` never returns when stdin is an open pipe rather than a TTY or /dev/null. Manual mode still consults stdin for the `echo "desc" | rex add` form, so it blocks on a read that never gets EOF. Observed: the command ran past a 120s timeout and had to be killed; re-running the identical command with `< /dev/null` completed immediately. This bites any non-interactive caller — CI, a spawned agent, a skill driving the CLI — and presents as a hang with no output rather than an error. Manual mode (an explicit level plus --title) should not read stdin at all; the piped form is only meaningful for smart mode.
