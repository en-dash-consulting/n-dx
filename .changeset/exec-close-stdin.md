---
"@n-dx/llm-client": patch
---

Close the child's stdin immediately when calling `exec()`. `execFile`
pipes stdio by default, but `exec` never writes to the child's stdin —
leaving it open caused any spawned process that reads stdin (e.g.
`rex add`'s `readStdin()` in non-TTY mode) to hang forever waiting for
an EOF that would never arrive. This was the root cause of the
dashboard Quick Add timing out at 240 s with zero output from a
daemonized `ndx start`.
