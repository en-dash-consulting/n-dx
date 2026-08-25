---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Review follow-ups on session usage recording and the adversarial-review skill.

- **The usage watermark can no longer rewind.** When the newest scanned transcript entry carried no `uuid`, the cursor kept the previous `lastUuid` while `consumed` advanced past it — and `lastUuid` wins on the next read, so everything between the two was claimed twice. The uuid watermark is now dropped when the tail has none, so the count governs and nothing is re-claimed. Latent rather than live (real transcripts stamp a uuid on every usage-bearing entry), but `uuid` is typed optional and the input is untrusted JSON parsed line-by-line, and the failure mode was silent inflation of exactly the number this module exists to make trustworthy.
- **`CLAUDE_CONFIG_DIR` is honoured when locating the transcript.** `resolveTranscriptPath` accepted a `configDir` option but nothing outside its own test passed one, so a user who relocated their Claude config tree silently recorded zero tokens. The environment variable is now consulted between the explicit option and the `~/.claude` default.
- **Transcript discovery probes with `stat` instead of a full read.** The existence probe read the whole file and threw the bytes away; the caller then read it again — twice the I/O on transcripts that reach tens of MB.
- **`ndx-adversarial-review` stages only what it wrote.** Its commit step inherited the house `git add -A`, but this skill's diff mode takes the dirty working tree as its review subject, so unscoped staging swept the user's in-progress work into a commit attributed to the review. It now runs `git add .rex/prd_tree/` and scopes its porcelain check the same way; the other committing skills, which never take a dirty tree as input, keep `git add -A`.
