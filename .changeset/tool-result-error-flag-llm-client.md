---
"@n-dx/llm-client": patch
---

A tool result now carries an optional `isError` flag. The Claude parsers set it from `is_error`, and the Codex parser sets it from a command's failed status or non-zero exit code. It is left unset when the stream says nothing.
