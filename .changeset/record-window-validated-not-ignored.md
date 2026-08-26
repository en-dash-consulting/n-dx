---
"@n-dx/hench": patch
---

`hench record` no longer silently claims a whole session when its usage window is missing or malformed.

`--startedAt` doubles as the usage window: the earliest spend a record may claim. Two paths quietly widened that window to the entire transcript. An unparseable value — `--startedAt=25/08/2026`, the shape a locale-formatted `Get-Date` produces — was accepted and discarded, taking the same branch as no window at all. And omitting the flag on a session's first record (the CLI help's own first example) claimed every usage-bearing message the session had, with the total reported as plain fact; measured while building the feature, that was 549 messages and 127M cache-read tokens attributed to one PRD item.

Now an unparseable `--startedAt`/`--since` is a hard error naming the flag — the precedent `--turns=abc` already set — instead of an accepted no-op. A genuinely windowless first record still writes (recording a whole session is legitimate when the whole session was the task), but warns first, naming the message count it is about to claim and pointing at `--startedAt`. `hench record --help` states both behaviors, and its first example now passes `--startedAt`.

The one behavior change to scripts: a sloppy timestamp that used to be ignored now fails the command. That is the point — the silent path put wrong numbers in `get_token_usage` and `ndx usage` with nothing marking them suspicious.
