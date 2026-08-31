---
"@n-dx/rex": patch
---

Compact the JSON that rex prompts send and ask for.

Six prompt builders embedded their payload with `JSON.stringify(x, null, 2)` —
guard, breakdown, consolidate, assess, modify, decompose. Indentation is billed
as input on every analyze call and buys nothing: the model reads the shape from
the keys, not the whitespace. On a five-proposal payload the embedded JSON drops
37% (9,297 → 5,896 characters).

The two few-shot examples were hand-written pretty JSON, so they carried the
same cost and, once the prompts started asking for minified output, contradicted
their own instruction. Both are now minified.

Output is where the real saving is — output tokens cost roughly 5x input on
every tier — so the shared `OUTPUT_INSTRUCTION` and the bespoke instructions in
the assessment, decompose, and reshape prompts now ask for minified JSON
explicitly ("no whitespace between tokens, no indentation, no line breaks") and
tell the model not to restate the input.

Response parsers are unchanged and still pass: they already tolerated fences and
surrounding prose, and compact JSON parses identically.

The new `prompt-json-discipline.test.ts` builds each prompt and asserts the
result carries no indented JSON and does ask for minified output. It checks
behaviour rather than grepping for `null, 2`, because grep cannot tell a prompt
from the many legitimate pretty-printers in the tree — `--format=json` CLI
output and on-disk config files are supposed to stay readable, and were left
alone.
