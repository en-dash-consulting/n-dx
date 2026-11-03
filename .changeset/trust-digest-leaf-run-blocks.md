---
"@n-dx/llm-client": patch
---

Repository trust reads the `run` block from every Markdown file under the PRD roots, not only `index.md`, so a run block saved on a leaf task or subtask (`<slug>.md`) moves the digest like one on a folder node.
