---
"@n-dx/web": patch
---

Add the gated SourceVision Ask tab and its prompt/response view shell

The Ask panel is now reachable: a default-off `sourcevision.ask` feature flag, a `SOURCEVISION_TABS` entry, and registration in `view-id.ts`, `view-routing.ts` and `view-registry.ts` so the tab deep-links like its siblings. The shell owns the prompt textarea, the submit control and four visually distinct states (idle, submitting, answered, error); it renders whatever `POST /api/sourcevision/ask` reports rather than talking to a provider itself. An empty or whitespace-only prompt is a no-op, and a second submit while one is in flight is ignored so two answers cannot race into the panel. Like the isometric map, the tab is hidden in a static export and the view explains why if reached by URL.

`renderMarkdownPreview` moved out of `pr-markdown.ts` into `views/markdown-preview.ts` so both panels share one block renderer instead of drifting apart.

Also defines the `--font-mono` design token. The markdown, ask and command panels referenced a `--mono` that was never defined and silently fell back to the inherited sans stack, and `call-graph-explorer.css` reached it only through a `monospace` fallback; `--line` and `--panel2` were likewise undefined in the markdown styles and are now `--border` and `--bg-surface`.
