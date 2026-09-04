---
"@n-dx/sourcevision": patch
---

Discover isometric-map infrastructure from CloudFormation and SAM templates, not only Terraform. `.yaml`/`.yml` files are scanned for a top-level `Resources:` block plus a namespaced `Type:` — strict enough that a CI workflow or a k8s manifest is never mistaken for infrastructure — and resource types are normalised (`AWS::SQS::Queue` → `aws_sqs_queue`) so both dialects share the one classification table instead of each carrying its own. Name literals come from `BucketName`/`QueueName`/… properties but never from a `!Ref` or `!Sub`, which is not a name. A project on CloudFormation now gets infrastructure nodes with nothing declared by hand in `.n-dx.json`.
