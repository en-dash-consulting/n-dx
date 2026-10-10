---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

Claude in Bedrock mode keeps its IRSA (`AWS_WEB_IDENTITY_TOKEN_FILE`,
`AWS_ROLE_ARN`, `AWS_ROLE_SESSION_NAME`), ECS/Fargate (`AWS_CONTAINER_*`) and
`AWS_CA_BUNDLE` variables. When Bedrock or Vertex mode is on and none of that
mode's credential names reach the child, the run reports it once, by name only.
