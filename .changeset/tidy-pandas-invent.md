---
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

One host-neutral git-remote-URL parser, in `@n-dx/llm-client`

`parseGitRemoteUrl` splits an origin remote into `{ host, owner, repo, path, kind }`
for https, ssh and scp-style forms, where `kind` distinguishes `github`,
`bitbucket-cloud`, a self-hosted `bitbucket-dc` and `other`. Data Center's `/scm/`
clone prefix is dropped from the identity path, so the same repository parses the
same way over https and ssh.

The three readers that each had their own regex now share it: sourcevision's
analysis manifest and iso export, and the web dashboard's project route. They
disagreed — web's split on `[/:]` read `ssh://git@host:7999/PROJ/repo.git` as the
repo `repo` with no owner, while sourcevision's could not parse that form at all.
A new architecture-policy rule fails the build on a second parser.

An scp-style remote does not need a dotted host: `git@work-github:acme/widget.git`
(an ssh config alias) and `git@bitbucket:PROJ/widget.git` (a short internal
hostname) parse like any other. Only a one-character host is refused, because
that is a Windows drive letter and git reads `C:\src\repo` as a local path.
