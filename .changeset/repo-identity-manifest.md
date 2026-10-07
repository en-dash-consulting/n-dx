---
"@n-dx/sourcevision": patch
---

Record the repository's identity on the analysis manifest.

`manifest.json` had `targetPath` and nothing else, so two analyses could not be told apart or correlated once they left their own directory. `Manifest.repo` now carries `name`, `remoteUrl`, `remoteHost`, `remotePath` and `defaultBranch`, populated on every run. A directory with no remote — or no git at all — still gets a populated identity, named after the directory, with the remote fields `null`: "looked and found no remote" is something the artifact can now say.

Reading the remote moved into `util/git-remote.ts`, which the iso export's source links now use too, so there is one implementation rather than two that can disagree. The field is optional, so an analysis produced before it existed still validates.

`remoteUrl` is the redacted remote: an origin such as `https://user:token@github.com/acme/widget.git` is recorded as `https://github.com/acme/widget.git`. Redaction happens in the reader, so no caller can hold the credentialed form — the manifest is designed to be committed and must not carry a token. scp-like `git@host:path` remotes are left intact; that username is not a secret.
