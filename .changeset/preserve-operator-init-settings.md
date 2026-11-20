---
"@n-dx/core": patch
---

`n-dx init` preserves operator MCP settings and model pins when refreshing assistant setup or switching providers.

Codex config refusals leave existing bytes intact while instructions and skills still refresh. MCP launch updates retain disabled-server settings, timeouts, extra fields and adjacent comments. Interactive confirmation keeps off-catalog pins, and provider switches retain each vendor's own compatible pin. Invalid namespace pins are cleared with a diagnostic.
