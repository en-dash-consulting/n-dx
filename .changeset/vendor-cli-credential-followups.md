---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

Follow-ups to the vendor CLI credential filter:

- Claude on Bedrock keeps its role and container credentials: the IRSA names
  (`AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_ROLE_ARN`, `AWS_ROLE_SESSION_NAME`), the
  ECS/Fargate `AWS_CONTAINER_*` names and `AWS_CA_BUNDLE` reach the CLI when
  `CLAUDE_CODE_USE_BEDROCK` is on, and are stripped when it is off. When Bedrock
  or Vertex mode is on and none of its credential variables are set, `ndx work`
  says so once, by name only.
- The cross-vendor reviewer falls back to the shell test command when its
  environment cannot be resolved (for example, an unreadable config), instead of
  failing the review.
- The reviewer's shell test command no longer inherits the raw environment. It
  gets the project's `hench.guard.env` policy, without the reviewer vendor's
  authentication variables. If that policy cannot be loaded, the default filter
  applies and the review banner says so.
- `ndx start --open` on Windows opens the dashboard without `cmd.exe`, so a
  `%NAME%`-shaped sequence in the URL's token or project id is no longer
  expanded.
