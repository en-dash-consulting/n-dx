---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

API and local agents edit files without rewriting them whole. hench's tool set for the API, local and Gemini loops gains `edit_file` (replace an exact `old_string` with `new_string`; it must match once unless `replace_all` is set, the error names the count, and CRLF files keep their line endings), and the system prompt tells those agents to use it for existing files. `write_file` now refuses to replace an existing file larger than `hench.guard.writeShrinkMinBytes` (default 1024) with content under `hench.guard.writeShrinkRatio` of its size (default 0.5, 0 disables) unless the call passes `rewrite: true`, and points the model at `edit_file`. Livelock, plan-only and completion checks, run summaries and run events count `edit_file` as a file change. Both keys are documented in `ndx config --help`, offered by `hench config` and the dashboard, and checked by the repository trust review.
