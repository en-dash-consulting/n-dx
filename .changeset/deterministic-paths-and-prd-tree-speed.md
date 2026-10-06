---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

Make the mechanical paths deterministic, and stop re-reading the PRD tree.

Two LLM/agent round trips that were doing work code can do exactly, and four
places where the PRD folder tree was read or written more times than once.
Measured on this repository's own PRD: 431 item directories, 1,853 files,
8.3 MB.

**Deterministic pre-run commit subject** (`hench.git.commitMessage`). The
pre-run commit gate asked a light-tier model for a one-line subject
summarising the operator's *pre-existing* uncommitted changes, and
`commit-subject.ts` existed to strip the preambles and fences that came back
before the text reached `git commit -m`. The subject is now computed from the
dirty file list — `chore(rex,web): pre-run checkpoint, 12 files, 340 lines` —
with the conventional-commit type inferred only where the file list proves it
(`docs`, `test`, else `chore`; never `feat` or `fix`, which are claims about
intent). This also replaces the fixed `"chore: commit local changes before
hench run"` that every failed model call fell back to. Set
`hench.git.commitMessage: "llm"` to restore the model.

**No duplicate `in_progress` write** (`hench.promptAgentToMarkInProgress`).
The API-path prompt told the agent to mark its task `in_progress` via
`rex_update_status`, but hench already made that transition before the agent
starts (`transitionToInProgress`, both loops). The step cost a tool round
trip and a second write of a value already on disk, which also left
`.rex/prd_tree/` dirty ahead of the uncommitted-work gate. The *completion*
step is unchanged and not comparable: that call is a request rex parks on the
task claim rather than a PRD write, and it carries the `resolutionType` and
`resolutionDetail` hench applies once the test gate passes.

**Faster folder-tree parse** (no flag; output is byte-identical). The parser
issued a `readdir` for each of the four scans a directory gets and a `stat`
per entry to find subdirectories, all strictly sequentially. It now reads each
directory once with `withFileTypes` and parses sibling subtrees concurrently
under a bounded gate. Warnings and digest insertion order are merged in
sibling order, so a depth-first walk's exact output is preserved — pinned by
`parse-order-equivalence.test.ts` and verified byte-for-byte against the
previous implementation on the full tree. **803 ms → 206 ms.**

**No duplicate full-tree write.** Eighteen call sites ran
`syncFolderTree(rexDir, store)` immediately after a store mutation.
`FileStore` has written the tree inside the mutation's own locked span since
the tree became the backend, so each of those re-read the whole PRD and
re-serialized it for no byte of change — and did so *less* safely, since
`syncFolderTree` passes no `loadedAt`/`loadedFiles` and so runs with the
stale-save guard disarmed. Removed; the function stays for deliberate
full-tree rebuilds. **~1.2 s saved per mutation.**

**Single-parse reads** (`performance.fastReads`, default off).
`loadItemsPreferFolderTree` parsed the tree, separately loaded the document —
which parses the same tree — and merged the two, on top of the load its
callers had already done. The merge predates the folder tree being the
backend; both sides are now the same parse. `rex next` **2.41 s → 749 ms**
with the flag on, output byte-identical.

**Single-item writes** (`performance.fastWrites`, default off). A one-field
update handed the whole document to the serializer, which walked every
directory to find that all but one file was unchanged. The targeted path
writes the item's own `index.md` and its parent's (whose children table
prints the child's title and status) and nothing else, declining to the full
write whenever the change could move a file or the item's on-disk path is not
where the serializer would put it. `updateItem` **782 ms → 315 ms.**

Both `performance` flags read from `.rex/config.json`, overridable per
command with `REX_FAST_READS` / `REX_FAST_WRITES`. They default off: the
previous path stays the one that ships until the new one is chosen
deliberately.
