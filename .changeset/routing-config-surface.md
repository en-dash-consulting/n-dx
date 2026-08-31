---
"@n-dx/core": patch
"@n-dx/web": patch
---

Expose the task-routing config surface in `ndx config` and the dashboard.

`ndx config` now validates `llm.tiers.<vendor>.<tier>`, `llm.routes.<class>`,
`llm.effort.<class>`, and `llm.escalation.*`, and documents them in `--help`
along with the fact that top-level `llm.model` is a standard-tier shorthand
rather than a global override. The dashboard's LLM config route accepts the
same keys, plus `llm.model` itself — writable via the CLI but previously absent
from the route's allowlist, so the field with the highest precedence over the
model actually used was invisible in the UI.

Validation is deliberately asymmetric. Values are checked strictly, and so is
the shape of a tier path: an unrecognized vendor or tier there is a typo, never
a feature. Route and effort *class names* stay open, because glob keys
(`prd.*`, `*`) are the documented routing design and this layer cannot see the
task-class registry without importing across a tier boundary.

Both surfaces also had to learn that task classes contain dots. Since config
paths use dots as separators, `llm.routes.agent.execute` would otherwise write
a nested `{agent: {execute}}` object — which the flat-map extractor in
`loadLLMConfig` silently ignores, making the setting appear to work while
changing nothing. Those two sections now treat everything after the section
name as one literal key, on both the read and write paths.
