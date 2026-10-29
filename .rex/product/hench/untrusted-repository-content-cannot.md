---
id: "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
type: "constraint"
title: "Untrusted repository content cannot widen what n-dx runs or which credentials reach a child process"
slug: "untrusted-repository-content-cannot"
statement: "Until the user accepts a checkout's execution config with `ndx trust accept .`, nothing the repository ships may widen what n-dx runs, the binaries it spawns, the paths the agent may write, where credentials are sent, or which credentials reach a child process. That covers config files, marker files, PRD content, binary paths and endpoints. Repository content can only tighten the user's defaults."
appliesTo: "all"
---

## History

- 2026-10-27 e1559fb6-7446-43a3-801b-edd47b1e2078 added: Add the repository-trust constraint
