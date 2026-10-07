---
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

`--no-review` and `--no-skip-test-gate` turn a saved setting off for one run.

Once a task can save `review: true` or `skipTestGate: true`, a one-off run needs a way to overrule it. Both new flags resolve as `cli-flag`, so they outrank the task's saved block and `hench.*` alike, and — being flags — they apply to every task in a `--loop` or `--iterations` run. `--no-review` carries the saved `reviewModel` and `reviewOptional` with it: there is no reviewer left for them to configure.

A flag and its negation together is an error rather than a guess (`--review` with `--no-review`, `--skip-test-gate` with `--no-skip-test-gate`), as are `--review-model` or `--review-optional` alongside `--no-review`.

**Behaviour change for dashboard clients.** The run-option tables now carry a `negatedFlag` for the two booleans a task can save, so `runOptionArgs` turns an explicit `review: false` / `skipTestGate: false` into `--no-review` / `--no-skip-test-gate` instead of emitting nothing. That is what lets the dashboard say "off for this run even though the task saved it on". An **absent** key still emits nothing, which is how a request leaves the decision to the task and the config, and booleans nothing can save (`fresh`, `allowDirty`, `reviewOptional`) are unchanged — their `false` still says nothing.
