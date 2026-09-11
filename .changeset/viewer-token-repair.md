---
"@n-dx/web": patch
---

Define the monospace token the viewer's panels ask for, and repair three that existed nowhere

`--mono`, `--line` and `--panel2` were referenced without a fallback in `pr-markdown.css` and `commands.css` and defined in no stylesheet, so those declarations were dropped: the markdown and command panels rendered in the inherited sans stack, on transparent surfaces, with no borders. They now point at `--font-mono`, `--border` and `--bg-surface`.

`--font-mono` is newly defined. Eight other stylesheets already referenced that name through a `monospace` fallback, so they were getting the fallback rather than the intended stack.

A test now asserts that every token used without a fallback resolves. The viewer carries a backlog of these — `llm-provider.css` is written against a `--color-*` / `--spacing-*` scheme the project never adopted — which the test allowlists rather than fixes, since choosing replacement values is a visual decision. The allowlist is itself checked for staleness, so an entry that gets defined has to be removed rather than quietly granting permission to break it again.
