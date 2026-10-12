---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Review is now a project setting: `hench.review.mode` (`off`, `self`, `pair`;
default `off`), `hench.review.vendor` (`claude` or `codex`; unset means the
other one) and `hench.review.rounds` (1-3, default 2). `self` runs the review
pass exactly as `--review` does; `--review`, `--no-review` and a task's saved
`run.review` still win. `pair` is recognised but pair review is not built yet,
so it runs no review and says so — it never falls back to self review. Pair
mode is refused when the reviewer is the executor's own vendor, the executor is
not claude or codex, or the provider is `api`. `ndx config` rejects values
outside those sets, and `ndx work --resolve` reports the three settings under
`review`, each with the key that supplied it.
