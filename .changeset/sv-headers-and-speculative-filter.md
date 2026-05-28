---
"@n-dx/sourcevision": patch
---

Stop fabricating findings against documented files. The enrichment prompt now
includes each batched file's leading doc-comment block as an authoritative
header excerpt (TS/JS/Swift/Rust/Python/Go/HTML/MD comment conventions are
recognized). The LLM is explicitly told not to call a documented file
"undocumented".

Adds a defensive backstop that drops findings whose text begins with a
hypothesis ("If X then…", "Should/Might/May/Could/Possibly/Perhaps…",
"It may/might/could/appears/seems…"). Dropped findings are logged with a
single-line count so the user knows what was filtered. The prompt guard
already discouraged these; this filter catches the leaks.

Also marks `projectDir` as in-memory-only on `ProjectProfile` so the
on-disk `.sourcevision/project-profile.json` stays portable across machines.
