---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Cut re-sent tokens in the agent loops: prompt caching, a summarizing prune, and a primer-seeded orientation.

hench: the Anthropic turn loop now places `cache_control` breakpoints — one on
the system block (which covers the tool schemas rendered ahead of it) and a
rolling one on the newest user turn, plus a fixed one on the task brief. The
tool definitions and system prompt were previously re-sent at full input price
on every turn.

hench: history pruning no longer splices the oldest turns away. The dropped span
is digested into a single retained message through the `context.summarize` task
class (light tier), so what the agent had already established survives, and the
cut is snapped to an assistant turn so it can no longer orphan a `tool_result`
whose `tool_use` was just removed. Applies to the Anthropic, local, and Gemini
loops; a summarization failure degrades to the previous drop rather than failing
the run.

hench: the orientation session is seeded with `.sourcevision/PRIMER.md` when it
matches the current analysis, so it confirms what sourcevision already
established instead of rediscovering it.

hench: fixed the fingerprint separator in `sourcevisionFingerprint`, which was an
invisible NUL byte where sourcevision's `primerFingerprint` uses a space. The two
could never agree. Existing cached orientation sessions are invalidated once.

core: `ndx work` context assembly now ignores a primer whose stamp disagrees with
the current analysis, falling back to CONTEXT.md. A primer that cannot be checked
— unstamped, or no readable manifest — is still used.
