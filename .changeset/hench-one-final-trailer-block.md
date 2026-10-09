---
"@n-dx/hench": patch
---

Hench writes its commit trailers as one final trailer block. The work commit used to append N-DX, N-DX-Item and Co-Authored-By one at a time with blank lines between them, so git — and rex's realized-by edge, which reads `%(trailers:key=N-DX-Item)` — could not see the item. They now join the agent's own trailer block when the message ends in one. The PRD-record commit also carries an `N-DX:` line, and the agent's commit instructions say to write trailers as one block.
