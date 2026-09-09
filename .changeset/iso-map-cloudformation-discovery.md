---
"@n-dx/sourcevision": patch
---

Discover CloudFormation resources in the isometric map, not just Terraform.

`discoverFromIaC` parsed Terraform `resource` blocks only, so teams on
CloudFormation got no infrastructure nodes and had to declare everything by
hand in `.n-dx.json`. `.yaml`/`.yml` files that prove themselves templates — by
an `AWSTemplateFormatVersion` header or a `Type: AWS::…` line — are now scanned
for logical-id/`Type:` pairs. Unrelated YAML (CI workflows, Kubernetes
manifests, lockfiles) is rejected by that check rather than parsed.

Both formats share one classification table rather than a copy each: resource
types are normalised by folding `::`, `-` and `.` to `_`, so `AWS::S3::Bucket`
and `aws_s3_bucket` reduce to the same shape and the existing substring
patterns serve both. Scheduler and compute gained the two CloudFormation
spellings normalisation alone does not reach (`Events::Rule`, `ECS::Service`).

The parser is a shallow line scanner, matching the Terraform side's existing
depth and keeping the module on `node:` builtins so it still bundles into the
standalone `/iso-map` skill script. Nested stacks, `!Ref` intrinsics and
multi-document files are out of scope; a `Properties:` block is read whether it
precedes or follows `Type:`.
