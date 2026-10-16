---
"@n-dx/core": patch
---

`ndx install-sample` on a v2 project adds the sample as a change with two tasks through `rex add`, instead of writing a `prd_tree/` beside `product/`; `ndx destroy-sample` removes it. A v1 project is unchanged.

Changes what a CLI command writes under the soft freeze: on a v2 project `ndx install-sample` and `ndx destroy-sample` write the change layer (`{rex}/changes/`), not `prd_tree/`. No flag changes shape.
