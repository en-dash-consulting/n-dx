---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Redact secrets in the logged `commandLine`, and cover every secret pattern in the twin tests.

`cli-log` redacted `args` but wrote `commandLine` through verbatim. On Windows that is the same data twice: `buildWindowsCliCommandLine(binary, args)` embeds the argv into the command line, so a key that `redactArgs` correctly replaced with `<redacted>` in the `args` field reappeared in full in `commandLine` on the same log line of `claude_commands.log`.

`redactArgs` cannot be reused for this, and reaching for it makes things worse rather than better. It iterates its argument, so handing it a string walks the individual characters — every pattern is anchored (`^sk-ant-…`), no single character matches, and the field is emitted as an array of letters with the secret fully intact:

```json
"commandLine":["c","l","a","u","d","e"," ","-","-","a","p","i","-","k","e","y"," ","s","k","-","a","n","t","-","S","E","C","R","E","T"]
```

So both twins gain a `redactCommandLine(line)` that tokenises on whitespace, preserves the original spacing, and applies the same `SECRET_FLAGS` / `SECRET_PATTERNS` tables through the surrounding quotes that `buildWindowsCliCommandLine` adds. Returns a string, as the field's own type always claimed.

**Two of the four `SECRET_PATTERNS` were never exercised.** The parity block drove five fixed records, and between them they only ever hit `gh[pousr]_`; the per-twin behaviour block added `sk-ant-`. Nothing anywhere passed an `AIza…` (Google AI Studio) or a non-Anthropic `sk-…` token, in either twin. Either pattern could have been dropped from either copy with the whole suite green — and a dropped pattern means the key it matches is written to disk in plaintext. Both now have cases, plus `redactCommandLine` coverage per twin and a secret-bearing `commandLine` in the parity records.

Verified by deleting the `AIza` pattern from the core twin alone: 4 assertions fail across both the behaviour and parity blocks, where previously that deletion was invisible.

Also corrects both twins' TWIN docblock, which pointed at `tests/unit/cli-log-parity.test.js`. No such file exists — the guard is the `cli-log twin parity` block inside `tests/unit/cli-log.test.js`. A pointer whose only job is telling the next person where the tripwire is should not name a file that was never there.
