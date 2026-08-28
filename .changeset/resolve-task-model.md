---
"@n-dx/llm-client": patch
---

Add `resolveTaskModel` — the class→tier→model resolution layer over
`resolveVendorModel`.

Call sites declare what kind of work a call is (a task class such as
`prd.rename` or `git.commit-message`), config maps classes to tiers, and the
vendor catalog maps tiers to models. Ships the built-in `DEFAULT_ROUTES`
registry (mechanical single-shot classes → light; judgment work → standard;
`agent.execute` stays standard until telemetry justifies heavy), new
`LLMConfig` surfaces (`tiers` per-vendor tier→model overrides including the
`free` tier, `routes` with exact-then-longest-glob-prefix matching, `effort`
per class, `escalation` policy shape), and never-throw semantics: unknown
classes route to standard, unknown tier names degrade to standard, a `free`
route without a configured model falls through to light, and vendors that
cannot distinguish tiers resolve to the nearest available model. This makes
the previously unreachable heavy tier reachable via
`llm.routes["agent.execute"] = "heavy"` with no code change.
