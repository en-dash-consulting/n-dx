---
"@n-dx/rex": patch
---

Stop `rex add` hanging forever when stdin is an open pipe.

`dispatchAdd` awaited `readStdin()` before deciding which mode it was in, so
every invocation paid for the piped-description form. `readStdin` guards on
`isTTY`, and a `/dev/null` redirect reaches EOF at once — so the bug was
invisible interactively and in most scripts, and bit the caller that matters
most: anything spawning the CLI with `stdio: "pipe"` and no intention of
writing. The pipe never closes, `end` never fires, and the command waits
forever with no output. Manual mode is identified entirely by argv, so it now
runs without touching stdin: 147ms instead of unbounded.

Two related faults surfaced while testing:

- An unrecognised `--level` fell through to smart mode, which then waited on
  stdin for a description that was never coming — a typo presented as a hang.
  It is now an error naming the valid levels.
- The remaining legitimate waits were silent. They now announce themselves on
  stderr after two seconds. The read itself is deliberately *not* bounded: a
  first attempt cut it off after a deadline and silently discarded a payload
  whose first byte arrived at three seconds. Losing piped input is worse than
  waiting for it, so the fix bounds the silence rather than the read.

The piped smart-add form (`echo "desc" | rex add`) is unchanged.
